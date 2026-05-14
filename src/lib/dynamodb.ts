import { fetchAuthSession } from "aws-amplify/auth";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import { configureAmplify, hasIdentityPool } from "./amplify";

const region =
  (import.meta.env.VITE_AWS_REGION as string | undefined) ??
  (import.meta.env.VITE_COGNITO_REGION as string | undefined);

const profileTableName = import.meta.env.VITE_PROFILE_TABLE_NAME as string | undefined;
const loadsTableName =
  (import.meta.env.VITE_LOADS_TABLE_NAME as string | undefined) ?? "Loads";
const trucksTableName =
  (import.meta.env.VITE_TRUCKS_TABLE_NAME as string | undefined) ?? "TruckBoard";

export function getProfileTableName() {
  if (!profileTableName) {
    throw new Error(
      "Missing VITE_PROFILE_TABLE_NAME. Add it to your .env to enable DynamoDB.",
    );
  }
  return profileTableName;
}

export function getLoadsTableName() {
  return loadsTableName;
}

export function getTrucksTableName() {
  return trucksTableName;
}

export function isDynamoConfigured() {
  return Boolean(region && profileTableName && hasIdentityPool());
}

let cached: DynamoDBDocumentClient | null = null;
let cachedExpiry = 0;

export async function getDynamoDocClient(): Promise<DynamoDBDocumentClient> {
  configureAmplify();
  if (!hasIdentityPool()) {
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
