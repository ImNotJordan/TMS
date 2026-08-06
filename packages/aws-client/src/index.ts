import { Amplify } from "aws-amplify";
import { cognitoUserPoolsTokenProvider } from "aws-amplify/auth/cognito";
import { defaultStorage } from "aws-amplify/utils";
import { fetchAuthSession } from "aws-amplify/auth";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  ScanCommand,
  type QueryCommandInput,
  type ScanCommandInput,
} from "@aws-sdk/lib-dynamodb";

export type AmplifyBasicsEnv = {
  region?: string;
  userPoolId?: string;
  userPoolClientId?: string;
  identityPoolId?: string;
};

export type ConfigureAmplifyBasicsOptions = {
  env?: AmplifyBasicsEnv;
  /** Custom warning prefix (defaults to "[amplify]"). */
  warnLabel?: string;
};

let amplifyConfigured = false;

function readAmplifyEnv(override?: AmplifyBasicsEnv): AmplifyBasicsEnv {
  return {
    region: override?.region ?? (import.meta.env.VITE_COGNITO_REGION as string | undefined),
    userPoolId:
      override?.userPoolId ?? (import.meta.env.VITE_COGNITO_USER_POOL_ID as string | undefined),
    userPoolClientId:
      override?.userPoolClientId ??
      (import.meta.env.VITE_COGNITO_USER_POOL_CLIENT_ID as string | undefined),
    identityPoolId:
      override?.identityPoolId ??
      (import.meta.env.VITE_COGNITO_IDENTITY_POOL_ID as string | undefined),
  };
}

/**
 * Shared Amplify Auth configure for ops console + driver portal.
 * Idempotent; no-ops on the server / missing env.
 */
export function configureAmplifyBasics(options?: ConfigureAmplifyBasicsOptions) {
  if (amplifyConfigured) return;
  if (typeof window === "undefined") return;

  const { region, userPoolId, userPoolClientId, identityPoolId } = readAmplifyEnv(options?.env);
  const label = options?.warnLabel ?? "[amplify]";

  if (!region || !userPoolId || !userPoolClientId) {
    console.warn(
      `${label} Cognito env vars are missing. Set VITE_COGNITO_REGION, VITE_COGNITO_USER_POOL_ID and VITE_COGNITO_USER_POOL_CLIENT_ID.`,
    );
    return;
  }

  if (identityPoolId) {
    Amplify.configure({
      Auth: {
        Cognito: {
          userPoolId,
          userPoolClientId,
          identityPoolId,
          allowGuestAccess: false,
          signUpVerificationMethod: "code",
          loginWith: {
            email: true,
            username: false,
          },
        },
      },
    });
  } else {
    Amplify.configure({
      Auth: {
        Cognito: {
          userPoolId,
          userPoolClientId,
          signUpVerificationMethod: "code",
          loginWith: {
            email: true,
            username: false,
          },
        },
      },
    });
  }

  cognitoUserPoolsTokenProvider.setKeyValueStorage(defaultStorage);
  amplifyConfigured = true;
}

export function hasIdentityPoolBasics(identityPoolId?: string) {
  const id =
    identityPoolId ?? (import.meta.env.VITE_COGNITO_IDENTITY_POOL_ID as string | undefined);
  return Boolean(id);
}

export function getAwsRegionBasics() {
  return (
    (import.meta.env.VITE_AWS_REGION as string | undefined) ??
    (import.meta.env.VITE_COGNITO_REGION as string | undefined)
  );
}

/** Subset of LoadRecord fields shared by driver portal + lightweight clients. */
export type SharedLoadRecordSubset = {
  loadId: string;
  createdAt: string;
  updatedAt: string;
  loadStatus?: string;
  assignedDriver?: string;
  driverWorkflowStatus?: string;
  documentAssets?: Array<{
    kind?: string;
    dataUrl?: string;
    fileName?: string;
    contentType?: string;
  }>;
};

export type SharedTrackingMessage = {
  loadId: string;
  messageId: string;
  from: "driver" | "ops" | "system";
  text: string;
  timestamp: string;
  docKind?: "bol" | "pod";
  fileName?: string;
  contentType?: string;
  assetId?: string;
};

/**
 * Paginated DynamoDB Scan — follows LastEvaluatedKey until exhausted.
 * Client is loosely typed so ops console + driver-portal can share this helper
 * even when each app resolves a different @aws-sdk/* install.
 */
export async function scanAllTableItems<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: { send: (...args: any[]) => Promise<any> },
  input: Omit<ScanCommandInput, "ExclusiveStartKey">,
): Promise<T[]> {
  const items: T[] = [];
  let cursor: Record<string, unknown> | undefined;

  do {
    const out = (await client.send(
      new ScanCommand({
        ...input,
        ...(cursor ? { ExclusiveStartKey: cursor } : {}),
      }),
    )) as { Items?: T[]; LastEvaluatedKey?: Record<string, unknown> };
    if (out.Items?.length) {
      items.push(...out.Items);
    }
    cursor = out.LastEvaluatedKey;
  } while (cursor);

  return items;
}

/**
 * Paginated DynamoDB Query — follows LastEvaluatedKey until exhausted.
 */
export async function queryAllItems<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: { send: (...args: any[]) => Promise<any> },
  input: Omit<QueryCommandInput, "ExclusiveStartKey">,
): Promise<T[]> {
  const items: T[] = [];
  let cursor: Record<string, unknown> | undefined;

  do {
    const out = (await client.send(
      new QueryCommand({
        ...input,
        ...(cursor ? { ExclusiveStartKey: cursor } : {}),
      }),
    )) as { Items?: T[]; LastEvaluatedKey?: Record<string, unknown> };
    if (out.Items?.length) {
      items.push(...out.Items);
    }
    cursor = out.LastEvaluatedKey;
  } while (cursor);

  return items;
}

export type CreateDynamoDocClientOptions = {
  region?: string;
  /** Called before fetching the Amplify auth session (e.g. configureAmplifyBasics). */
  ensureConfigured?: () => void;
};

/**
 * Build a DocumentClient from the current Amplify auth session credentials.
 * Does not cache — callers may wrap with their own cache.
 */
export async function createDynamoDocClientFromSession(
  options?: CreateDynamoDocClientOptions,
): Promise<DynamoDBDocumentClient> {
  options?.ensureConfigured?.();

  const region = options?.region ?? getAwsRegionBasics();
  if (!region) {
    throw new Error("Missing VITE_AWS_REGION (or VITE_COGNITO_REGION) in .env.");
  }
  if (!hasIdentityPoolBasics()) {
    throw new Error(
      "Cognito Identity Pool is not configured. Set VITE_COGNITO_IDENTITY_POOL_ID in .env.",
    );
  }

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

  return DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true },
  });
}
