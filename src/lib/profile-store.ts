import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

import { getDynamoDocClient, getProfileTableName, queryAllItems } from "./dynamodb";
import { createRateLimitedExecutor } from "./rate-limit";

const PROFILE_READ_RATE_LIMIT_MS = 300;
const PROFILE_WRITE_RATE_LIMIT_MS = 1200;
const runProfileReadLimited = createRateLimitedExecutor(PROFILE_READ_RATE_LIMIT_MS);
const runProfileWriteLimited = createRateLimitedExecutor(PROFILE_WRITE_RATE_LIMIT_MS);

export type SectionKey =
  | "personal"
  | "preferences"
  | "notifications"
  | "security"
  | "permissions"
  | "documents"
  | "integrations"
  | "company";

export type ProfileItem<T> = {
  userId: string;
  section: SectionKey;
  data: T;
  updatedAt: string;
};

function describeError(err: unknown, op: string): Error {
  if (err instanceof Error) {
    // AWS SDK errors carry a `name` like "AccessDeniedException" and sometimes
    // a `$metadata` blob; surface the most useful bits.
    const awsName = (err as { name?: string }).name;
    const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    const detail = [awsName && `${awsName}`, status && `HTTP ${status}`, err.message]
      .filter(Boolean)
      .join(" · ");
    console.error(`[DynamoDB ${op}]`, err);
    return new Error(`DynamoDB ${op} failed: ${detail}`);
  }
  console.error(`[DynamoDB ${op}]`, err);
  return new Error(`DynamoDB ${op} failed`);
}

export type SectionLoadResult<T> = {
  data: T | null;
  updatedAt: string | null;
};

export async function getSection<T = Record<string, unknown>>(
  userId: string,
  section: SectionKey,
): Promise<SectionLoadResult<T>> {
  return runProfileReadLimited(async () => {
    try {
      const client = await getDynamoDocClient();
      const out = await client.send(
        new GetCommand({
          TableName: getProfileTableName(),
          Key: { userId, section },
        }),
      );
      const item = out.Item as ProfileItem<T> | undefined;
      return {
        data: (item?.data ?? null) as T | null,
        updatedAt: item?.updatedAt ?? null,
      };
    } catch (err) {
      throw describeError(err, "GetItem");
    }
  });
}

export async function putSection<T = Record<string, unknown>>(
  userId: string,
  section: SectionKey,
  data: T,
): Promise<void> {
  return runProfileWriteLimited(async () => {
    try {
      const client = await getDynamoDocClient();
      await client.send(
        new PutCommand({
          TableName: getProfileTableName(),
          Item: {
            userId,
            section,
            data,
            updatedAt: new Date().toISOString(),
          } satisfies ProfileItem<T>,
        }),
      );
    } catch (err) {
      throw describeError(err, "PutItem");
    }
  });
}

/**
 * Merge `patch` into the existing section document so partial UIs
 * (e.g. Profile → Role & Permissions) cannot wipe RBAC matrices.
 */
export async function putSectionMerge(
  userId: string,
  section: SectionKey,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const existing = await getSection<Record<string, unknown>>(userId, section);
  const base =
    existing.data && typeof existing.data === "object" && !Array.isArray(existing.data)
      ? existing.data
      : {};
  const merged = { ...base, ...patch };
  await putSection(userId, section, merged);
  return merged;
}

export async function getAllSections(
  userId: string,
): Promise<Partial<Record<SectionKey, unknown>>> {
  return runProfileReadLimited(async () => {
    try {
      const client = await getDynamoDocClient();
      const items = await queryAllItems<ProfileItem<unknown>>(client, {
        TableName: getProfileTableName(),
        KeyConditionExpression: "userId = :u",
        ExpressionAttributeValues: { ":u": userId },
      });
      const map: Partial<Record<SectionKey, SectionLoadResult<unknown>>> = {};
      for (const item of items) {
        map[item.section] = {
          data: item.data ?? null,
          updatedAt: item.updatedAt ?? null,
        };
      }
      return map;
    } catch (err) {
      throw describeError(err, "Query");
    }
  });
}
