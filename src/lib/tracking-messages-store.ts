import { DeleteCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

import {
  getAwsRegion,
  getDynamoDocClient,
  getTrackingMessagesTableName,
  isDynamoResourceNotFound,
  isTrackingMessagesConfigured,
  queryAllItems,
} from "./dynamodb";
import { createRateLimitedExecutor } from "./rate-limit";

export type TrackingMessageSender = "driver" | "ops" | "system";

export type TrackingMessageDto = {
  id: string;
  from: TrackingMessageSender;
  text: string;
  timestamp: string;
  docKind?: "bol" | "pod";
  fileName?: string;
  contentType?: string;
  assetId?: string;
};

const MESSAGES_READ_RATE_LIMIT_MS = 300;
const MESSAGES_WRITE_RATE_LIMIT_MS = 600;

const runReadLimited = createRateLimitedExecutor(MESSAGES_READ_RATE_LIMIT_MS);
const runWriteLimited = createRateLimitedExecutor(MESSAGES_WRITE_RATE_LIMIT_MS);

export type TrackingMessageRecord = {
  loadId: string;
  /** Sort key — ISO timestamp prefix keeps chronological order. */
  messageId: string;
  from: TrackingMessageSender;
  text: string;
  timestamp: string;
  docKind?: "bol" | "pod";
  fileName?: string;
  contentType?: string;
  assetId?: string;
};

function describeError(err: unknown, op: string): Error {
  if (err instanceof Error) {
    if (isDynamoResourceNotFound(err)) {
      const table = getTrackingMessagesTableName();
      const awsRegion = getAwsRegion() ?? "your AWS region";
      console.error(`[DynamoDB TrackingMessages ${op}] table not found`, err);
      return new Error(
        `DynamoDB table "${table}" was not found in ${awsRegion}. ` +
          `Create it with partition key "loadId" (String) and sort key "messageId" (String), ` +
          `then set VITE_TRACKING_MESSAGES_TABLE_NAME=${table} in .env.`,
      );
    }
    const awsName = (err as { name?: string }).name;
    const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    const detail = [awsName && `${awsName}`, status && `HTTP ${status}`, err.message]
      .filter(Boolean)
      .join(" · ");
    console.error(`[DynamoDB TrackingMessages ${op}]`, err);
    return new Error(`DynamoDB TrackingMessages ${op} failed: ${detail}`);
  }
  console.error(`[DynamoDB TrackingMessages ${op}]`, err);
  return new Error(`DynamoDB TrackingMessages ${op} failed`);
}

export function createTrackingMessageId(loadId: string) {
  return `${new Date().toISOString()}#${loadId}-msg-${Math.random().toString(36).slice(2, 8)}`;
}

function recordToMessage(record: TrackingMessageRecord): TrackingMessageDto {
  return {
    id: record.messageId,
    from: record.from,
    text: record.text,
    timestamp: record.timestamp,
    docKind: record.docKind,
    fileName: record.fileName,
    contentType: record.contentType,
    assetId: record.assetId,
  };
}

export async function listTrackingMessages(loadId: string): Promise<TrackingMessageDto[]> {
  if (!loadId.trim()) return [];
  if (!isTrackingMessagesConfigured()) return [];

  return runReadLimited(async () => {
    try {
      const client = await getDynamoDocClient();
      const items = await queryAllItems<TrackingMessageRecord>(client, {
        TableName: getTrackingMessagesTableName(),
        KeyConditionExpression: "loadId = :loadId",
        ExpressionAttributeValues: { ":loadId": loadId.trim() },
        ScanIndexForward: true,
      });
      return items.map(recordToMessage);
    } catch (err) {
      throw describeError(err, "Query");
    }
  });
}

export async function putTrackingMessage(
  input: Omit<TrackingMessageRecord, "messageId"> & { messageId?: string },
): Promise<TrackingMessageDto> {
  if (!input.loadId?.trim()) {
    throw new Error("loadId is required");
  }
  if (!input.text?.trim()) {
    throw new Error("text is required");
  }
  if (!isTrackingMessagesConfigured()) {
    throw new Error(
      "Tracking messages table is not configured. Set VITE_TRACKING_MESSAGES_TABLE_NAME in .env.",
    );
  }

  const timestamp = input.timestamp ?? new Date().toISOString();
  const item: TrackingMessageRecord = {
    loadId: input.loadId.trim(),
    messageId: input.messageId ?? createTrackingMessageId(input.loadId),
    from: input.from,
    text: input.text.trim(),
    timestamp,
    ...(input.docKind ? { docKind: input.docKind } : {}),
    ...(input.fileName ? { fileName: input.fileName } : {}),
    ...(input.contentType ? { contentType: input.contentType } : {}),
    ...(input.assetId ? { assetId: input.assetId } : {}),
  };

  return runWriteLimited(async () => {
    try {
      const client = await getDynamoDocClient();
      await client.send(
        new PutCommand({
          TableName: getTrackingMessagesTableName(),
          Item: item,
        }),
      );
      return recordToMessage(item);
    } catch (err) {
      throw describeError(err, "PutItem");
    }
  });
}

export async function deleteTrackingMessageRecord(
  loadId: string,
  messageId: string,
): Promise<void> {
  if (!loadId.trim() || !messageId.trim()) {
    throw new Error("loadId and messageId are required");
  }
  if (!isTrackingMessagesConfigured()) {
    throw new Error(
      "Tracking messages table is not configured. Set VITE_TRACKING_MESSAGES_TABLE_NAME in .env.",
    );
  }

  return runWriteLimited(async () => {
    try {
      const client = await getDynamoDocClient();
      await client.send(
        new DeleteCommand({
          TableName: getTrackingMessagesTableName(),
          Key: { loadId: loadId.trim(), messageId: messageId.trim() },
        }),
      );
    } catch (err) {
      throw describeError(err, "DeleteItem");
    }
  });
}
