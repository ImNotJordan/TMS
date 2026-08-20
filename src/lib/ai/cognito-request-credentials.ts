import { fromCognitoIdentityPool } from "@aws-sdk/credential-providers";

import { ASSISTANT_CRED_CACHE_SKEW_MS } from "@/lib/ai/assistant-limits";

const cognitoRegionEnv = import.meta.env.VITE_COGNITO_REGION as string | undefined;
const awsRegionEnv =
  (import.meta.env.VITE_AWS_REGION as string | undefined) ?? cognitoRegionEnv;
const userPoolId = import.meta.env.VITE_COGNITO_USER_POOL_ID as string | undefined;
const identityPoolId = import.meta.env.VITE_COGNITO_IDENTITY_POOL_ID as string | undefined;

export type CognitoRequestAuthError =
  | "missing_token"
  | "misconfigured"
  | "credentials_failed"
  | "expired_token";

export class CognitoRequestAuthFailure extends Error {
  readonly code: CognitoRequestAuthError;

  constructor(code: CognitoRequestAuthError, message: string) {
    super(message);
    this.name = "CognitoRequestAuthFailure";
    this.code = code;
  }
}

export type IdTokenClaims = {
  sub?: string;
  iss?: string;
  exp?: number;
  tokenUse?: string;
};

type CredCacheEntry = {
  credentials: RequestAwsCredentials;
  expiresAtMs: number;
};

const credCache = new Map<string, CredCacheEntry>();

function decodeJwtPayload(idToken: string): IdTokenClaims | null {
  try {
    const [, payloadB64] = idToken.split(".");
    if (!payloadB64) return null;
    const normalized = payloadB64.replace(/-/g, "+").replace(/_/g, "/");
    const json =
      typeof atob === "function"
        ? atob(normalized)
        : Buffer.from(payloadB64, "base64url").toString("utf8");
    const payload = JSON.parse(json) as Record<string, unknown>;
    return {
      sub: typeof payload.sub === "string" ? payload.sub : undefined,
      iss: typeof payload.iss === "string" ? payload.iss : undefined,
      exp: typeof payload.exp === "number" ? payload.exp : undefined,
      tokenUse: typeof payload.token_use === "string" ? payload.token_use : undefined,
    };
  } catch {
    return null;
  }
}

function cacheKeyForToken(idToken: string): string {
  // Avoid storing full JWT as map key forever — use ends + length.
  return `${idToken.length}:${idToken.slice(0, 16)}:${idToken.slice(-24)}`;
}

/** Extract Bearer token from Authorization header. */
export function readBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? request.headers.get("Authorization");
  if (!header) return null;
  const match = /^Bearer\s+(\S+)/i.exec(header.trim());
  return match?.[1]?.trim() || null;
}

export function readIdTokenClaims(request: Request): IdTokenClaims | null {
  const token = readBearerToken(request);
  if (!token) return null;
  return decodeJwtPayload(token);
}

/**
 * Prefer the region embedded in the ID token `iss` claim so the Identity Pool
 * login map matches the User Pool even when VITE_AWS_REGION differs.
 */
function cognitoRegionFromClaims(claims: IdTokenClaims | null): string | null {
  const match = /cognito-idp\.([a-z0-9-]+)\.amazonaws\.com/i.exec(claims?.iss ?? "");
  return match?.[1] ?? null;
}

export type RequestAwsCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  expiration?: Date;
};

export function getAwsRegionForDynamo(): string | undefined {
  return awsRegionEnv ?? cognitoRegionEnv;
}

export function assertValidIdToken(idToken: string): IdTokenClaims {
  const claims = decodeJwtPayload(idToken);
  if (!claims?.sub || !claims.exp) {
    throw new CognitoRequestAuthFailure("missing_token", "Invalid authorization token.");
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (claims.exp <= nowSec + 5) {
    throw new CognitoRequestAuthFailure("expired_token", "Session expired. Sign in again.");
  }
  if (claims.tokenUse && claims.tokenUse !== "id") {
    throw new CognitoRequestAuthFailure("missing_token", "Expected a Cognito ID token.");
  }
  if (userPoolId && claims.iss && !claims.iss.endsWith(`/${userPoolId}`)) {
    throw new CognitoRequestAuthFailure("missing_token", "Token issuer does not match this app.");
  }
  return claims;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Exchange a Cognito User Pool ID token for temporary Identity Pool AWS credentials.
 * Results are cached until near STS expiration to avoid Cognito stampede at scale.
 */
export async function getAwsCredentialsFromRequest(
  request: Request,
): Promise<RequestAwsCredentials> {
  const idToken = readBearerToken(request);
  if (!idToken) {
    throw new CognitoRequestAuthFailure(
      "missing_token",
      "Sign in required. Missing Authorization bearer token.",
    );
  }

  assertValidIdToken(idToken);

  if (!userPoolId || !identityPoolId) {
    throw new CognitoRequestAuthFailure(
      "misconfigured",
      "Cognito Identity Pool is not configured on the server.",
    );
  }

  const key = cacheKeyForToken(idToken);
  const cached = credCache.get(key);
  const now = Date.now();
  if (cached && cached.expiresAtMs - ASSISTANT_CRED_CACHE_SKEW_MS > now) {
    return cached.credentials;
  }

  const claims = decodeJwtPayload(idToken);
  const cognitoRegion =
    cognitoRegionFromClaims(claims) ?? cognitoRegionEnv ?? awsRegionEnv;
  if (!cognitoRegion) {
    throw new CognitoRequestAuthFailure(
      "misconfigured",
      "Cognito region is not configured on the server.",
    );
  }

  const loginKey = `cognito-idp.${cognitoRegion}.amazonaws.com/${userPoolId}`;
  const provider = fromCognitoIdentityPool({
    clientConfig: { region: cognitoRegion },
    identityPoolId,
    logins: {
      [loginKey]: idToken,
    },
  });

  try {
    const credentials = await withTimeout(provider(), 8_000, "Cognito Identity Pool");
    if (!credentials?.accessKeyId || !credentials.secretAccessKey) {
      throw new CognitoRequestAuthFailure(
        "credentials_failed",
        "Could not obtain AWS credentials from Cognito Identity Pool.",
      );
    }
    const result: RequestAwsCredentials = {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      sessionToken: credentials.sessionToken,
      expiration: credentials.expiration,
    };
    const expiresAtMs = credentials.expiration
      ? credentials.expiration.getTime()
      : now + 50 * 60_000;
    credCache.set(key, { credentials: result, expiresAtMs });
    return result;
  } catch (err) {
    if (err instanceof CognitoRequestAuthFailure) throw err;
    const message = err instanceof Error ? err.message : "Identity Pool credential exchange failed.";
    console.error("[ai] Identity Pool credential exchange failed", {
      loginKey,
      cognitoRegion,
      message,
    });
    throw new CognitoRequestAuthFailure("credentials_failed", message);
  }
}
