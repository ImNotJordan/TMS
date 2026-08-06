import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

import {
  getAwsRegion,
  getDynamoDocClient,
  getProfileTableName,
  getWorkspaceSettingsTableName,
  isDynamoAccessDenied,
  isDynamoConfigured,
  isDynamoResourceNotFound,
  isWorkspaceSettingsConfigured,
} from "./dynamodb";
import { createRateLimitedExecutor } from "./rate-limit";

/** Workspace-wide settings (not per-user profile). */
export const GLOBAL_SETTINGS_SCOPE = "global";

export type WorkspaceSettingsSection =
  | "integrations"
  | "appSettings"
  | "automations"
  | "webhooks"
  | "orgStructure"
  | "communications";

const READ_RATE_LIMIT_MS = 300;
const WRITE_RATE_LIMIT_MS = 800;

const runReadLimited = createRateLimitedExecutor(READ_RATE_LIMIT_MS);
const runWriteLimited = createRateLimitedExecutor(WRITE_RATE_LIMIT_MS);

export type WorkspaceSettingsItem<T> = {
  scope: typeof GLOBAL_SETTINGS_SCOPE;
  section: WorkspaceSettingsSection;
  data: T;
  updatedAt: string;
};

export type WorkspaceSettingsLoadResult<T> = {
  data: T | null;
  updatedAt: string | null;
};

function describeError(err: unknown, op: string): Error {
  if (err instanceof Error) {
    if (isDynamoResourceNotFound(err)) {
      const table = getWorkspaceSettingsTableName();
      const awsRegion = getAwsRegion() ?? "your AWS region";
      console.error(`[DynamoDB WorkspaceSettings ${op}] table not found`, err);
      return new Error(
        `DynamoDB table "${table}" was not found in ${awsRegion}. ` +
          `Create it with partition key "scope" (String) and sort key "section" (String), ` +
          `then set VITE_WORKSPACE_SETTINGS_TABLE_NAME=${table} in .env.`,
      );
    }
    if (isDynamoAccessDenied(err)) {
      const table = getWorkspaceSettingsTableName();
      console.error(`[DynamoDB WorkspaceSettings ${op}] access denied`, err);
      return new Error(
        `Access denied for DynamoDB table "${table}". ` +
          `Grant authenticated users GetItem/PutItem on this table via the Cognito identity pool role.`,
      );
    }
    const awsName = (err as { name?: string }).name;
    const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    const detail = [awsName && `${awsName}`, status && `HTTP ${status}`, err.message]
      .filter(Boolean)
      .join(" · ");
    console.error(`[DynamoDB WorkspaceSettings ${op}]`, err);
    return new Error(`DynamoDB WorkspaceSettings ${op} failed: ${detail}`);
  }
  console.error(`[DynamoDB WorkspaceSettings ${op}]`, err);
  return new Error(`DynamoDB WorkspaceSettings ${op} failed`);
}

export async function getWorkspaceSetting<T extends Record<string, unknown>>(
  section: WorkspaceSettingsSection,
): Promise<WorkspaceSettingsLoadResult<T>> {
  if (!isWorkspaceSettingsConfigured()) {
    return { data: null, updatedAt: null };
  }

  return runReadLimited(async () => {
    try {
      const client = await getDynamoDocClient();
      const out = await client.send(
        new GetCommand({
          TableName: getWorkspaceSettingsTableName(),
          Key: { scope: GLOBAL_SETTINGS_SCOPE, section },
        }),
      );
      const item = out.Item as WorkspaceSettingsItem<T> | undefined;
      return {
        data: (item?.data ?? null) as T | null,
        updatedAt: item?.updatedAt ?? null,
      };
    } catch (err) {
      throw describeError(err, "GetItem");
    }
  });
}

export async function putWorkspaceSetting<T extends Record<string, unknown>>(
  section: WorkspaceSettingsSection,
  data: T,
): Promise<void> {
  if (!isWorkspaceSettingsConfigured()) {
    throw new Error(
      "Workspace settings table is not configured. Set VITE_WORKSPACE_SETTINGS_TABLE_NAME and VITE_COGNITO_IDENTITY_POOL_ID in .env.",
    );
  }

  return runWriteLimited(async () => {
    try {
      const client = await getDynamoDocClient();
      await client.send(
        new PutCommand({
          TableName: getWorkspaceSettingsTableName(),
          Item: {
            scope: GLOBAL_SETTINGS_SCOPE,
            section,
            data,
            updatedAt: new Date().toISOString(),
          } satisfies WorkspaceSettingsItem<T>,
        }),
      );
    } catch (err) {
      throw describeError(err, "PutItem");
    }
  });
}

/** One-time migration source: org row previously stored on UsersTable. */
export async function loadLegacyIntegrationsFromProfileTable<
  T extends Record<string, unknown>,
>(): Promise<WorkspaceSettingsLoadResult<T>> {
  if (!isDynamoConfigured()) {
    return { data: null, updatedAt: null };
  }

  try {
    const client = await getDynamoDocClient();
    const out = await client.send(
      new GetCommand({
        TableName: getProfileTableName(),
        Key: { userId: "__org__", section: "orgIntegrations" },
      }),
    );
    const item = out.Item as { data?: T; updatedAt?: string } | undefined;
    return {
      data: (item?.data ?? null) as T | null,
      updatedAt: item?.updatedAt ?? null,
    };
  } catch {
    return { data: null, updatedAt: null };
  }
}
