import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

import { getDynamoDocClient, getProfileTableName } from "./dynamodb";

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
    // eslint-disable-next-line no-console
    console.error(`[DynamoDB ${op}]`, err);
    return new Error(`DynamoDB ${op} failed: ${detail}`);
  }
  // eslint-disable-next-line no-console
  console.error(`[DynamoDB ${op}]`, err);
  return new Error(`DynamoDB ${op} failed`);
}

export async function getSection<T = Record<string, unknown>>(
  userId: string,
  section: SectionKey,
): Promise<T | null> {
  try {
    const client = await getDynamoDocClient();
    const out = await client.send(
      new GetCommand({
        TableName: getProfileTableName(),
        Key: { userId, section },
      }),
    );
    return ((out.Item as ProfileItem<T> | undefined)?.data ?? null) as T | null;
  } catch (err) {
    throw describeError(err, "GetItem");
  }
}

export async function putSection<T = Record<string, unknown>>(
  userId: string,
  section: SectionKey,
  data: T,
): Promise<void> {
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
}

export async function getAllSections(userId: string): Promise<Partial<Record<SectionKey, unknown>>> {
  try {
    const client = await getDynamoDocClient();
    const out = await client.send(
      new QueryCommand({
        TableName: getProfileTableName(),
        KeyConditionExpression: "userId = :u",
        ExpressionAttributeValues: { ":u": userId },
      }),
    );
    const map: Partial<Record<SectionKey, unknown>> = {};
    for (const item of (out.Items as ProfileItem<unknown>[] | undefined) ?? []) {
      map[item.section] = item.data;
    }
    return map;
  } catch (err) {
    throw describeError(err, "Query");
  }
}
