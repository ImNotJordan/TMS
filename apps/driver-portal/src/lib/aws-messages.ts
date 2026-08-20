import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

import {
  getDynamoDocClient,
  getTrackingMessagesTableName,
  isTrackingMessagesConfigured,
} from "./dynamodb";
import { createRateLimitedExecutor } from "./rate-limit";

const runRead = createRateLimitedExecutor(300);
const runWrite = createRateLimitedExecutor(600);

export type TrackingMessageSender = "driver" | "ops" | "system";

export type TrackingMessageRecord = {
  loadId: string;
  messageId: string;
  from: TrackingMessageSender;
  text: string;
  timestamp: string;
  /** Optional document attachment metadata (payload lives on the load). */
  docKind?: "bol" | "pod";
  fileName?: string;
  contentType?: string;
  assetId?: string;
};

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

function describeError(err: unknown, op: string): Error {
  if (err instanceof Error) {
    console.error(`[DynamoDB TrackingMessages ${op}]`, err);
    return new Error(`Tracking messages ${op} failed: ${err.message}`);
  }
  return new Error(`Tracking messages ${op} failed`);
}

export function createTrackingMessageId(loadId: string) {
  return `${new Date().toISOString()}#${loadId}-msg-${Math.random().toString(36).slice(2, 8)}`;
}

function recordToDto(r: TrackingMessageRecord): TrackingMessageDto {
  return {
    id: r.messageId,
    from: r.from,
    text: r.text,
    timestamp: r.timestamp,
    docKind: r.docKind,
    fileName: r.fileName,
    contentType: r.contentType,
    assetId: r.assetId,
  };
}

export async function listTrackingMessages(loadId: string): Promise<TrackingMessageDto[]> {
  if (!loadId.trim() || !isTrackingMessagesConfigured()) return [];

  return runRead(async () => {
    try {
      const client = await getDynamoDocClient();
      const out = await client.send(
        new QueryCommand({
          TableName: getTrackingMessagesTableName(),
          KeyConditionExpression: "loadId = :loadId",
          ExpressionAttributeValues: { ":loadId": loadId.trim() },
          ScanIndexForward: true,
        }),
      );
      const items = (out.Items as TrackingMessageRecord[] | undefined) ?? [];
      return items.map(recordToDto);
    } catch (err) {
      throw describeError(err, "Query");
    }
  });
}

export async function putTrackingMessage(input: {
  loadId: string;
  from: TrackingMessageSender;
  text: string;
  messageId?: string;
  timestamp?: string;
  docKind?: "bol" | "pod";
  fileName?: string;
  contentType?: string;
  assetId?: string;
}): Promise<TrackingMessageDto> {
  if (!input.loadId?.trim()) throw new Error("loadId is required");
  if (!isTrackingMessagesConfigured()) {
    throw new Error("Tracking messages table is not configured.");
  }

  return runWrite(async () => {
    try {
      const client = await getDynamoDocClient();
      const timestamp = input.timestamp ?? new Date().toISOString();
      const messageId = input.messageId ?? createTrackingMessageId(input.loadId);
      const item: TrackingMessageRecord = {
        loadId: input.loadId.trim(),
        messageId,
        from: input.from,
        text: input.text.trim(),
        timestamp,
        ...(input.docKind ? { docKind: input.docKind } : {}),
        ...(input.fileName ? { fileName: input.fileName } : {}),
        ...(input.contentType ? { contentType: input.contentType } : {}),
        ...(input.assetId ? { assetId: input.assetId } : {}),
      };
      await client.send(
        new PutCommand({
          TableName: getTrackingMessagesTableName(),
          Item: item,
        }),
      );
      return recordToDto(item);
    } catch (err) {
      throw describeError(err, "PutItem");
    }
  });
}
