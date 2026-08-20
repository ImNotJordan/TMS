/**
 * Cognito admin client for the server, under the server's own IAM principal.
 *
 * Deliberately has **no fallback** to `getAwsCredentialsFromRequest`.
 *
 * That fallback exists in `server-aws.ts` and is fine for Dynamo reads, but it
 * exchanges the *caller's* token for Identity Pool credentials — the browser's
 * role. Using it here would mean admin Cognito calls still depended on the
 * browser role holding `cognito-idp:AdminUpdateUserAttributes`, which is exactly
 * the permission this endpoint exists to let you remove. Moving the call
 * server-side while keeping the browser's credentials would be theatre.
 *
 * If `TITAN_AWS_*` is not configured, this throws. A missing server principal is
 * a deployment error, not a reason to reach for the caller's credentials.
 */
import { CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";

import { getServerAiAwsRegion } from "@/lib/ai/server-aws";
import { readServerEnv } from "@/lib/server-env";

export class ServerPrincipalMissingError extends Error {
  readonly code = "SERVER_PRINCIPAL_MISSING";

  constructor() {
    super(
      "Server AWS credentials are not configured. Set TITAN_AWS_ACCESS_KEY_ID and " +
        "TITAN_AWS_SECRET_ACCESS_KEY as Worker secrets — see docs/security/stage-0-iam.md.",
    );
    this.name = "ServerPrincipalMissingError";
  }
}

let cachedClient: CognitoIdentityProviderClient | null = null;

export function getServerUserPoolId(): string {
  const poolId =
    readServerEnv("VITE_COGNITO_USER_POOL_ID") || readServerEnv("TITAN_COGNITO_USER_POOL_ID");
  if (!poolId) {
    throw new Error("Cognito User Pool is not configured on the server.");
  }
  return poolId;
}

/**
 * Cognito IDP client signed by the server principal.
 *
 * @throws ServerPrincipalMissingError when TITAN_AWS_* is absent.
 */
export function getServerCognitoClient(): CognitoIdentityProviderClient {
  if (cachedClient) return cachedClient;

  const accessKeyId = readServerEnv("TITAN_AWS_ACCESS_KEY_ID");
  const secretAccessKey = readServerEnv("TITAN_AWS_SECRET_ACCESS_KEY");
  if (!accessKeyId || !secretAccessKey) {
    throw new ServerPrincipalMissingError();
  }

  const region = getServerAiAwsRegion();
  if (!region) {
    throw new Error("AWS region is not configured on the server.");
  }

  cachedClient = new CognitoIdentityProviderClient({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
      sessionToken: readServerEnv("TITAN_AWS_SESSION_TOKEN"),
    },
  });
  return cachedClient;
}
