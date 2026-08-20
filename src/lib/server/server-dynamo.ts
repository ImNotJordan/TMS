/**
 * DynamoDB client for server-side data access, under the server's own IAM
 * principal.
 *
 * Deliberately has **no fallback** to the caller's Identity Pool credentials.
 *
 * `getAiDynamoClient` does fall back, which is tolerable for the settings reads
 * it was written for. It is not tolerable here. The entire point of the API tier
 * is that the browser stops holding DynamoDB permissions; a repository that
 * quietly borrows the caller's credentials when the server principal is missing
 * would keep working right up until you revoked those permissions, and then fail
 * in production having given you no warning in development.
 *
 * Missing credentials is a deployment error. It throws.
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import { readServerEnv } from "@/lib/server-env";

export class ServerDataPrincipalMissingError extends Error {
  readonly code = "SERVER_PRINCIPAL_MISSING";
  readonly status = 503;

  constructor() {
    super(
      "Server AWS credentials are not configured. Set TITAN_AWS_ACCESS_KEY_ID and " +
        "TITAN_AWS_SECRET_ACCESS_KEY — see docs/security/stage-0-iam.md.",
    );
    this.name = "ServerDataPrincipalMissingError";
  }
}

let cached: DynamoDBDocumentClient | null = null;

/**
 * @throws ServerDataPrincipalMissingError when TITAN_AWS_* is absent.
 */
export function getServerDataClient(): DynamoDBDocumentClient {
  if (cached) return cached;

  const accessKeyId = readServerEnv("TITAN_AWS_ACCESS_KEY_ID");
  const secretAccessKey = readServerEnv("TITAN_AWS_SECRET_ACCESS_KEY");
  if (!accessKeyId || !secretAccessKey) throw new ServerDataPrincipalMissingError();

  const region =
    readServerEnv("TITAN_AWS_REGION") ||
    readServerEnv("VITE_AWS_REGION") ||
    readServerEnv("VITE_COGNITO_REGION");
  if (!region) throw new Error("AWS region is not configured on the server.");

  cached = DynamoDBDocumentClient.from(
    new DynamoDBClient({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
        sessionToken: readServerEnv("TITAN_AWS_SESSION_TOKEN"),
      },
    }),
    { marshallOptions: { removeUndefinedValues: true } },
  );
  return cached;
}

/** Test seam. */
export function resetServerDataClientForTests() {
  cached = null;
}
