/**
 * Server-side AWS credentials for AI routes.
 * Prefer static IAM (`TITAN_AWS_*`) so WorkspaceSettings/Profile reads
 * do not require a Cognito Identity Pool exchange on every request.
 * Falls back to per-request Identity Pool credentials when IAM is unset.
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import {
  getAwsCredentialsFromRequest,
  getAwsRegionForDynamo,
  type RequestAwsCredentials,
} from "@/lib/ai/cognito-request-credentials";
import { readServerEnv as readEnv } from "@/lib/server-env";

export function hasServerAiIamCredentials(): boolean {
  return Boolean(readEnv("TITAN_AWS_ACCESS_KEY_ID") && readEnv("TITAN_AWS_SECRET_ACCESS_KEY"));
}

export function getServerAiAwsRegion(): string | undefined {
  return (
    readEnv("TITAN_AWS_REGION") ||
    readEnv("AWS_REGION") ||
    getAwsRegionForDynamo() ||
    readEnv("VITE_AWS_REGION") ||
    readEnv("VITE_COGNITO_REGION")
  );
}

function staticIamCredentials(): RequestAwsCredentials | null {
  const accessKeyId = readEnv("TITAN_AWS_ACCESS_KEY_ID");
  const secretAccessKey = readEnv("TITAN_AWS_SECRET_ACCESS_KEY");
  if (!accessKeyId || !secretAccessKey) return null;
  return {
    accessKeyId,
    secretAccessKey,
    sessionToken: readEnv("TITAN_AWS_SESSION_TOKEN"),
  };
}

let sharedIamClient: DynamoDBDocumentClient | null = null;

function clientFromCredentials(
  region: string,
  credentials: RequestAwsCredentials,
): DynamoDBDocumentClient {
  return DynamoDBDocumentClient.from(
    new DynamoDBClient({
      region,
      credentials: {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        sessionToken: credentials.sessionToken,
        expiration: credentials.expiration,
      },
    }),
    { marshallOptions: { removeUndefinedValues: true } },
  );
}

/** Shared IAM-backed Dynamo client (no per-request STS). */
export function getServerIamDynamoClient(): DynamoDBDocumentClient | null {
  const credentials = staticIamCredentials();
  const region = getServerAiAwsRegion();
  if (!credentials || !region) return null;
  if (!sharedIamClient) {
    sharedIamClient = clientFromCredentials(region, credentials);
  }
  return sharedIamClient;
}

/**
 * Dynamo client for AI server routes: IAM first, else Cognito Identity Pool.
 */
export async function getAiDynamoClient(request: Request): Promise<DynamoDBDocumentClient> {
  const iam = getServerIamDynamoClient();
  if (iam) return iam;

  const region = getServerAiAwsRegion();
  if (!region) {
    throw new Error("Missing AWS region for Logistics AI.");
  }
  const credentials = await getAwsCredentialsFromRequest(request);
  return clientFromCredentials(region, credentials);
}

export function getWorkspaceSettingsTable(): string {
  return (
    readEnv("VITE_WORKSPACE_SETTINGS_TABLE_NAME") ||
    readEnv("TITAN_WORKSPACE_SETTINGS_TABLE_NAME") ||
    "WorkspaceSettings"
  );
}

export function getProfileTable(): string {
  return readEnv("VITE_PROFILE_TABLE_NAME") || readEnv("TITAN_PROFILE_TABLE_NAME") || "Profile";
}

export function getAiDailyRequestBudget(): number {
  const raw = readEnv("TITAN_AI_DAILY_REQUEST_BUDGET");
  const n = raw ? Number(raw) : 50_000;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 50_000;
}
