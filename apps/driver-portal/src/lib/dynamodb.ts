import { fetchAuthSession } from "aws-amplify/auth";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  configureAmplifyBasics,
  getAwsRegionBasics,
  hasIdentityPoolBasics,
  scanAllTableItems,
} from "@titan/aws-client";

export { scanAllTableItems };

const region = getAwsRegionBasics();
const loadsTableName = (import.meta.env.VITE_LOADS_TABLE_NAME as string | undefined) ?? "Loads";
const trackingMessagesTableName =
  (import.meta.env.VITE_TRACKING_MESSAGES_TABLE_NAME as string | undefined) ?? "TrackingMessages";

export function getAwsRegion() {
  return region;
}

export function getLoadsTableName() {
  return loadsTableName;
}

export function getTrackingMessagesTableName() {
  return trackingMessagesTableName;
}

export function isTrackingMessagesConfigured() {
  return Boolean(region && trackingMessagesTableName && hasIdentityPoolBasics());
}

export function isLoadsConfigured() {
  return Boolean(region && loadsTableName && hasIdentityPoolBasics());
}

let cached: DynamoDBDocumentClient | null = null;
let cachedExpiry = 0;

/** Drop cached DocumentClient (call on sign-out). */
export function clearDynamoClientCache() {
  cached = null;
  cachedExpiry = 0;
}

/**
 * Driver-portal DocumentClient — local AWS SDK instance (avoids cross-workspace
 * @aws-sdk type identity clashes with the ops console install).
 */
export async function getDynamoDocClient(): Promise<DynamoDBDocumentClient> {
  configureAmplifyBasics();
  if (!hasIdentityPoolBasics()) {
    throw new Error(
      "Cognito Identity Pool is not configured. Set VITE_COGNITO_IDENTITY_POOL_ID in .env.",
    );
  }
  if (!region) {
    throw new Error("Missing VITE_AWS_REGION in .env.");
  }

  const now = Date.now();
  if (cached && now < cachedExpiry - 60_000) return cached;

  const session = await fetchAuthSession();
  const credentials = session.credentials;
  if (!credentials) {
    clearDynamoClientCache();
    throw new Error(
      "No AWS credentials. Ensure the user is signed in and the Identity Pool trusts the User Pool client.",
    );
  }

  const client = new DynamoDBClient({
    region,
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      sessionToken: credentials.sessionToken,
      expiration: credentials.expiration,
    },
  });

  cached = DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true },
  });
  cachedExpiry = credentials.expiration ? credentials.expiration.getTime() : now + 30 * 60_000;
  return cached;
}
