import { fromCognitoIdentityPool } from "@aws-sdk/credential-providers";

import { ASSISTANT_CRED_CACHE_SKEW_MS } from "@/lib/ai/assistant-limits";
import { CognitoRequestAuthFailure } from "@/lib/ai/auth-failure";
import { verifyCognitoJwt, type VerifiedClaims } from "@/lib/ai/verify-cognito-jwt";

export { CognitoRequestAuthFailure };
export type { CognitoRequestAuthError } from "@/lib/ai/auth-failure";

const cognitoRegionEnv = import.meta.env.VITE_COGNITO_REGION as string | undefined;
const awsRegionEnv = (import.meta.env.VITE_AWS_REGION as string | undefined) ?? cognitoRegionEnv;
const userPoolId = import.meta.env.VITE_COGNITO_USER_POOL_ID as string | undefined;
const identityPoolId = import.meta.env.VITE_COGNITO_IDENTITY_POOL_ID as string | undefined;

export type IdTokenClaims = VerifiedClaims;

type CredCacheEntry = {
  credentials: RequestAwsCredentials;
  expiresAtMs: number;
};

const credCache = new Map<string, CredCacheEntry>();

function cacheKeyForToken(idToken: string): string {
  // Avoid storing full JWT as map key forever — use ends + length.
  return `${idToken.length}:${idToken.slice(0, 16)}:${idToken.slice(-24)}`;
}

/** Extract Bearer token from Authorization header. Header only — never body, query, or cookie. */
export function readBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? request.headers.get("Authorization");
  if (!header) return null;
  const match = /^Bearer\s+(\S+)/i.exec(header.trim());
  return match?.[1]?.trim() || null;
}

/**
 * Per-request memo so a handler that needs claims in three places pays for
 * signature verification once. Keyed on the Request object itself, so it cannot
 * leak between requests the way a module-scoped `Map` keyed by `sub` would.
 */
const verifiedClaimsByRequest = new WeakMap<Request, Promise<VerifiedClaims>>();

/**
 * Fully verify the request's bearer token and return its claims.
 *
 * This is the only way to read claims on the server. There is deliberately no
 * decode-without-verify accessor: the previous one made every downstream role
 * and identity check trivially forgeable.
 *
 * @throws CognitoRequestAuthFailure when absent, malformed, or unverifiable.
 */
export function requireVerifiedIdClaims(request: Request): Promise<VerifiedClaims> {
  const memo = verifiedClaimsByRequest.get(request);
  if (memo) return memo;

  const promise = (async () => {
    const token = readBearerToken(request);
    if (!token) {
      throw new CognitoRequestAuthFailure(
        "missing_token",
        "Sign in required. Missing Authorization bearer token.",
      );
    }
    return verifyCognitoJwt(token, { tokenUse: "id" });
  })();

  verifiedClaimsByRequest.set(request, promise);
  // A rejected promise must not be memoized as a permanent failure for a
  // retried request object; drop it so the next call re-evaluates.
  void promise.catch(() => verifiedClaimsByRequest.delete(request));
  return promise;
}

/**
 * Verified claims, or `null` when the caller wants to branch rather than throw.
 * Still fully verified — `null` means "not authenticated", never "unchecked".
 */
export async function tryVerifiedIdClaims(request: Request): Promise<VerifiedClaims | null> {
  try {
    return await requireVerifiedIdClaims(request);
  } catch (err) {
    if (err instanceof CognitoRequestAuthFailure) return null;
    throw err;
  }
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
 * The token is fully verified first — the Identity Pool would reject a forged
 * token too, but failing here keeps the rejection cheap and the error honest.
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

  const claims = await requireVerifiedIdClaims(request);

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

  // `iss` is verified, so the region embedded in it is trustworthy and matches
  // the pool the Identity Pool login map expects.
  const cognitoRegion =
    /cognito-idp\.([a-z0-9-]+)\.amazonaws\.com/i.exec(claims.iss)?.[1] ??
    cognitoRegionEnv ??
    awsRegionEnv;
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
    const message =
      err instanceof Error ? err.message : "Identity Pool credential exchange failed.";
    console.error("[ai] Identity Pool credential exchange failed", {
      loginKey,
      cognitoRegion,
      message,
    });
    throw new CognitoRequestAuthFailure("credentials_failed", message);
  }
}
