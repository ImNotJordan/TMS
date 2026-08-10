/**
 * Tracking messages — dispatch side.
 *
 * ## Transport
 *
 * `/api/tracking-messages`, not DynamoDB. The browser holds no credentials for
 * the TrackingMessages table.
 *
 * The load id is still the thing being asked for, but the server now checks the
 * caller may see that load before it returns the conversation. Previously this
 * module queried on whatever `loadId` it was handed — so any signed-in user
 * could read any load's dispatch/driver thread, attachments included, just by
 * knowing or guessing an id.
 *
 * Exported names and signatures are unchanged so no screen moved.
 */
import { fetchAuthSession } from "aws-amplify/auth";

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

const PATH = "/api/tracking-messages";
const MESSAGES_READ_RATE_LIMIT_MS = 300;
const MESSAGES_WRITE_RATE_LIMIT_MS = 600;

const runReadLimited = createRateLimitedExecutor(MESSAGES_READ_RATE_LIMIT_MS);
const runWriteLimited = createRateLimitedExecutor(MESSAGES_WRITE_RATE_LIMIT_MS);

async function authHeaders(): Promise<Record<string, string>> {
  try {
    const session = await fetchAuthSession();
    const token = session.tokens?.idToken?.toString();
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

async function send(path: string, init?: RequestInit): Promise<Response> {
  const headers = await authHeaders();
  return fetch(path, {
    ...init,
    headers: { ...headers, ...(init?.body ? { "content-type": "application/json" } : {}) },
  });
}

async function failure(response: Response, op: string): Promise<Error> {
  let message = `Tracking messages ${op} failed (HTTP ${response.status})`;
  try {
    const body = (await response.json()) as { error?: string };
    if (body?.error) message = body.error;
  } catch {
    /* non-JSON error body — the status line is enough */
  }
  return new Error(message);
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

  return runReadLimited(async () => {
    const response = await send(`${PATH}?loadId=${encodeURIComponent(loadId.trim())}`);
    // A load the caller cannot see is indistinguishable from one that does not
    // exist, and neither is an error worth surfacing — the thread is empty.
    if (response.status === 404) return [];
    if (!response.ok) throw await failure(response, "Query");
    const body = (await response.json()) as { messages?: TrackingMessageRecord[] };
    return (body.messages ?? []).map(recordToMessage);
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
    const response = await send(PATH, { method: "POST", body: JSON.stringify(item) });
    if (!response.ok) throw await failure(response, "PutItem");
    const body = (await response.json()) as { message?: TrackingMessageRecord };
    return recordToMessage(body.message ?? item);
  });
}

export async function deleteTrackingMessageRecord(
  loadId: string,
  messageId: string,
): Promise<void> {
  if (!loadId.trim() || !messageId.trim()) {
    throw new Error("loadId and messageId are required");
  }

  return runWriteLimited(async () => {
    const query = `loadId=${encodeURIComponent(loadId.trim())}&messageId=${encodeURIComponent(messageId.trim())}`;
    const response = await send(`${PATH}?${query}`, { method: "DELETE" });
    // Already gone is the desired end state.
    if (response.status === 404) return;
    if (!response.ok) throw await failure(response, "DeleteItem");
  });
}
