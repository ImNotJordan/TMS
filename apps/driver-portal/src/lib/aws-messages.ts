/**
 * Tracking messages — driver side.
 *
 * Goes to the console's `/api/tracking-messages`; the portal holds no DynamoDB
 * credentials for the table. The server checks the load is assigned to this
 * driver before returning or accepting anything, so a driver sees exactly the
 * threads for their own loads.
 *
 * Exported names and signatures are unchanged so no screen moved.
 */
import { fetchAuthSession } from "aws-amplify/auth";

import { apiUrl } from "./api-base";
import { createRateLimitedExecutor } from "./rate-limit";

const runRead = createRateLimitedExecutor(300);
const runWrite = createRateLimitedExecutor(600);

const PATH = "/api/tracking-messages";

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
  return fetch(apiUrl(path), {
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
  if (!loadId.trim()) return [];

  return runRead(async () => {
    const response = await send(`${PATH}?loadId=${encodeURIComponent(loadId.trim())}`);
    // Not assigned to this driver reads the same as no such load: an empty
    // thread, not an error.
    if (response.status === 404) return [];
    if (!response.ok) throw await failure(response, "Query");
    const body = (await response.json()) as { messages?: TrackingMessageRecord[] };
    return (body.messages ?? []).map(recordToDto);
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

  return runWrite(async () => {
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
    const response = await send(PATH, { method: "POST", body: JSON.stringify(item) });
    if (!response.ok) throw await failure(response, "PutItem");
    const body = (await response.json()) as { message?: TrackingMessageRecord };
    return recordToDto(body.message ?? item);
  });
}
