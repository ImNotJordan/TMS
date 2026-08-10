/**
 * Cognito JWT verification.
 *
 * Replaces the previous decode-and-trust path. Every claim this module returns
 * has been checked against the User Pool's published signing keys:
 *
 *   - `alg` pinned to RS256 — a token declaring `none` or `HS256` is rejected
 *     before any key lookup, so the classic algorithm-confusion swap cannot
 *     turn the public modulus into an HMAC secret.
 *   - `kid` must be present and must resolve to a key in the cached JWKS.
 *   - Signature verified with WebCrypto (available in both the Cloudflare
 *     Worker runtime and Node 18+; no Node-only crypto dependency).
 *   - `iss` compared to the exact User Pool URL, not a suffix.
 *   - `aud` (ID tokens) / `client_id` (access tokens) matched to this app client.
 *   - `token_use` asserted, so an access token cannot stand in for an ID token.
 *     The two carry different claim sets and different user influence.
 *   - `exp` / `nbf` / `iat` enforced with a small fixed skew.
 *
 * Anything that fails throws `CognitoRequestAuthFailure`. There is no partial
 * success and no path that returns unverified claims.
 */
import { CognitoRequestAuthFailure } from "@/lib/ai/auth-failure";
import { readServerEnv } from "@/lib/server-env";

/** Cognito signs with RS256 only. Anything else is rejected outright. */
const PINNED_ALG = "RS256";
const CLOCK_SKEW_SEC = 60;
const JWKS_TTL_MS = 60 * 60_000;
/** Floor between forced refetches so an unknown-kid flood can't hammer Cognito. */
const JWKS_MIN_REFETCH_MS = 5 * 60_000;
const JWKS_FETCH_TIMEOUT_MS = 5_000;

export type TokenUse = "id" | "access";

export type VerifiedClaims = {
  sub: string;
  iss: string;
  token_use: TokenUse;
  exp: number;
  iat: number;
  aud?: string;
  client_id?: string;
  auth_time?: number;
  /** Remaining Cognito claims (email, custom:*, cognito:groups, …). */
  [claim: string]: unknown;
};

type JsonWebKey_ = {
  kid?: string;
  kty?: string;
  n?: string;
  e?: string;
  alg?: string;
  use?: string;
};

export type VerifyOptions = {
  tokenUse: TokenUse;
  /** Overrides for tests; production reads env. */
  userPoolId?: string;
  clientId?: string;
  region?: string;
  /** Epoch seconds; defaults to now. */
  nowSec?: number;
  fetchImpl?: typeof fetch;
};

function fail(
  code: ConstructorParameters<typeof CognitoRequestAuthFailure>[0],
  message: string,
): never {
  throw new CognitoRequestAuthFailure(code, message);
}

/**
 * Pool IDs are `<region>_<suffix>`, so the region travels with the pool and
 * cannot drift from a separately-configured env var.
 */
function regionForPool(userPoolId: string, override?: string): string {
  const fromPool = userPoolId.split("_")[0];
  if (fromPool && /^[a-z]{2}-[a-z]+-\d$/.test(fromPool)) return fromPool;
  const fallback =
    override ?? readServerEnv("VITE_COGNITO_REGION") ?? readServerEnv("VITE_AWS_REGION");
  if (!fallback) {
    fail("misconfigured", "Cognito region is not configured on the server.");
  }
  return fallback;
}

function resolveConfig(options: VerifyOptions) {
  const userPoolId = options.userPoolId ?? readServerEnv("VITE_COGNITO_USER_POOL_ID");
  const clientId = options.clientId ?? readServerEnv("VITE_COGNITO_USER_POOL_CLIENT_ID");
  if (!userPoolId || !clientId) {
    // Fail closed: without a pool and client to pin against, verification is
    // meaningless and every downstream authorization decision is unsound.
    fail("misconfigured", "Cognito User Pool is not configured on the server.");
  }
  const region = regionForPool(userPoolId, options.region);
  return {
    userPoolId,
    clientId,
    issuer: `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`,
  };
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    fail("invalid_token", "Malformed authorization token.");
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64UrlToJson<T>(value: string): T {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlToBytes(value))) as T;
  } catch {
    fail("invalid_token", "Malformed authorization token.");
  }
}

type JwksCacheEntry = { keys: Map<string, JsonWebKey_>; fetchedAtMs: number };

const jwksCache = new Map<string, JwksCacheEntry>();
const jwksInflight = new Map<string, Promise<JwksCacheEntry>>();

async function fetchJwks(issuer: string, fetchImpl: typeof fetch): Promise<JwksCacheEntry> {
  const inflight = jwksInflight.get(issuer);
  if (inflight) return inflight;

  const promise = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), JWKS_FETCH_TIMEOUT_MS);
    try {
      const response = await fetchImpl(`${issuer}/.well-known/jwks.json`, {
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`JWKS fetch failed (HTTP ${response.status})`);
      }
      const body = (await response.json()) as { keys?: JsonWebKey_[] };
      const keys = new Map<string, JsonWebKey_>();
      for (const key of body.keys ?? []) {
        if (key.kid && key.kty === "RSA" && key.n && key.e) keys.set(key.kid, key);
      }
      if (keys.size === 0) throw new Error("JWKS contained no usable RSA keys");
      const entry: JwksCacheEntry = { keys, fetchedAtMs: Date.now() };
      jwksCache.set(issuer, entry);
      return entry;
    } finally {
      clearTimeout(timer);
      jwksInflight.delete(issuer);
    }
  })();

  jwksInflight.set(issuer, promise);
  return promise;
}

async function resolveSigningKey(
  issuer: string,
  kid: string,
  fetchImpl: typeof fetch,
): Promise<JsonWebKey_> {
  const cached = jwksCache.get(issuer);
  const fresh = cached && Date.now() - cached.fetchedAtMs < JWKS_TTL_MS;

  if (cached && cached.keys.has(kid) && fresh) return cached.keys.get(kid)!;

  // Unknown kid or stale cache — refetch, but not more often than the floor,
  // so a stream of bogus kids cannot be used to hammer Cognito through us.
  const canRefetch = !cached || Date.now() - cached.fetchedAtMs > JWKS_MIN_REFETCH_MS;
  if (canRefetch) {
    try {
      const refreshed = await fetchJwks(issuer, fetchImpl);
      const key = refreshed.keys.get(kid);
      if (key) return key;
    } catch (err) {
      // A JWKS outage must not become an authentication bypass.
      console.error("[auth] JWKS fetch failed", err instanceof Error ? err.message : String(err));
      fail("invalid_token", "Could not verify your session. Try again.");
    }
  } else if (cached?.keys.has(kid)) {
    return cached.keys.get(kid)!;
  }

  fail("invalid_token", "Token signing key is not recognized.");
}

async function verifySignature(
  jwk: JsonWebKey_,
  signingInput: string,
  signature: Uint8Array,
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: "RSA", n: jwk.n, e: jwk.e, alg: PINNED_ALG, ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    signature as unknown as ArrayBuffer,
    new TextEncoder().encode(signingInput) as unknown as ArrayBuffer,
  );
}

/**
 * Verify a Cognito JWT end to end and return its claims.
 *
 * @throws CognitoRequestAuthFailure on any verification failure.
 */
export async function verifyCognitoJwt(
  token: string,
  options: VerifyOptions,
): Promise<VerifiedClaims> {
  const { clientId, issuer } = resolveConfig(options);
  const fetchImpl = options.fetchImpl ?? fetch;

  const parts = token.split(".");
  if (parts.length !== 3) fail("invalid_token", "Malformed authorization token.");
  const [headerB64, payloadB64, signatureB64] = parts;

  const header = base64UrlToJson<{ alg?: string; kid?: string }>(headerB64);

  // Pin before anything else: `alg: none` and RS256→HS256 confusion both die here.
  if (header.alg !== PINNED_ALG) {
    fail("invalid_token", "Unsupported token signing algorithm.");
  }
  if (!header.kid) fail("invalid_token", "Token is missing a signing key id.");

  const jwk = await resolveSigningKey(issuer, header.kid, fetchImpl);
  const signatureValid = await verifySignature(
    jwk,
    `${headerB64}.${payloadB64}`,
    base64UrlToBytes(signatureB64),
  );
  if (!signatureValid) fail("invalid_token", "Token signature is not valid.");

  // Only now are the claims worth reading.
  const claims = base64UrlToJson<Record<string, unknown>>(payloadB64);
  const nowSec = options.nowSec ?? Math.floor(Date.now() / 1000);

  if (claims.iss !== issuer) fail("invalid_token", "Token issuer does not match this app.");

  if (claims.token_use !== options.tokenUse) {
    fail("invalid_token", "Unexpected token type.");
  }

  // ID tokens carry `aud`; access tokens carry `client_id`.
  const audience = options.tokenUse === "id" ? claims.aud : claims.client_id;
  const audienceMatches = Array.isArray(audience)
    ? audience.includes(clientId)
    : audience === clientId;
  if (!audienceMatches) fail("invalid_token", "Token was not issued for this app.");

  if (typeof claims.exp !== "number" || claims.exp <= nowSec - CLOCK_SKEW_SEC) {
    fail("expired_token", "Session expired. Sign in again.");
  }
  if (typeof claims.nbf === "number" && claims.nbf > nowSec + CLOCK_SKEW_SEC) {
    fail("invalid_token", "Token is not yet valid.");
  }
  if (typeof claims.iat !== "number" || claims.iat > nowSec + CLOCK_SKEW_SEC) {
    fail("invalid_token", "Token issue time is not valid.");
  }
  if (typeof claims.sub !== "string" || !claims.sub) {
    fail("invalid_token", "Token is missing a subject.");
  }

  return claims as VerifiedClaims;
}

/** Test seam — drops cached JWKS so a test can control the fetch. */
export function resetJwksCacheForTests() {
  jwksCache.clear();
  jwksInflight.clear();
}
