/**
 * Loads transport — HTTP to `/api/loads`, not DynamoDB.
 *
 * The browser no longer reads or writes the Loads table. It asks the server,
 * which derives the tenant from the verified token and scopes every query. Once
 * every store moves this way, `dynamodb:*` on the operational tables comes off
 * the Identity Pool role entirely, and the tenant boundary stops depending on
 * client code behaving.
 *
 * ## Why this strips server-owned fields
 *
 * The API rejects a payload carrying `companyId`, `createdBy`, `createdAt` or
 * `updatedAt` with a 400 — deliberately, so an attempt is visible rather than
 * silently dropped. But the ops console legitimately holds whole `LoadRecord`
 * objects that already have those fields, and sending one back on an edit is not
 * an attack, it is the obvious thing to do.
 *
 * So the transport strips them on the way out. The server's rejection stays as
 * the backstop for anything that is not this client.
 */
import { fetchAuthSession } from "aws-amplify/auth";

import type { LoadRecord } from "@/lib/loads-store";

const LOADS_ENDPOINT = "/api/loads";

/** Owned by the server. Never sent, always overwritten. */
const SERVER_OWNED_FIELDS = ["companyId", "createdBy", "createdAt", "updatedAt"] as const;

export class LoadsApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "LoadsApiError";
    this.status = status;
    this.code = code;
  }

  /** The caller has no company yet — the UI should prompt, not retry. */
  get needsCompany(): boolean {
    return this.code === "COMPANY_ASSIGNMENT_REQUIRED";
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  try {
    const session = await fetchAuthSession();
    const token = session.tokens?.idToken?.toString();
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

function withoutServerOwnedFields<T extends Record<string, unknown>>(
  input: T,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if ((SERVER_OWNED_FIELDS as readonly string[]).includes(key)) continue;
    if (value === undefined) continue;
    out[key] = value;
  }
  return out;
}

type ApiFailure = { error?: string; code?: string };

/** `body` is a value to serialize here, not a `BodyInit` — hence the Omit. */
async function request<T>(
  path: string,
  init: Omit<RequestInit, "body"> & { body?: unknown } = {},
): Promise<{ status: number; body: T | null }> {
  const { body, ...rest } = init;
  const response = await fetch(path, {
    ...rest,
    headers: {
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(await authHeaders()),
      ...(rest.headers as Record<string, string> | undefined),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  if (response.status === 204) return { status: 204, body: null };

  const parsed = (await response.json().catch(() => null)) as (T & ApiFailure) | null;
  if (!response.ok) {
    throw new LoadsApiError(
      parsed?.error ?? `Request failed (HTTP ${response.status}).`,
      response.status,
      parsed?.code,
    );
  }
  return { status: response.status, body: parsed };
}

export async function apiListLoads(): Promise<LoadRecord[]> {
  const { body } = await request<{ loads: LoadRecord[] }>(LOADS_ENDPOINT);
  return body?.loads ?? [];
}

/** `null` for a load that does not exist *or* belongs to another company. */
export async function apiGetLoad(loadId: string): Promise<LoadRecord | null> {
  const id = loadId?.trim();
  if (!id) return null;
  try {
    const { body } = await request<{ load: LoadRecord }>(
      `${LOADS_ENDPOINT}/${encodeURIComponent(id)}`,
    );
    return body?.load ?? null;
  } catch (err) {
    if (err instanceof LoadsApiError && err.status === 404) return null;
    throw err;
  }
}

export async function apiCreateLoad(
  input: Omit<LoadRecord, "createdAt" | "updatedAt">,
): Promise<LoadRecord> {
  const { body } = await request<{ load: LoadRecord }>(LOADS_ENDPOINT, {
    method: "POST",
    body: withoutServerOwnedFields(input as unknown as Record<string, unknown>),
  });
  if (!body?.load) throw new LoadsApiError("Create returned no record.", 502);
  return body.load;
}

export async function apiUpdateLoad(
  loadId: string,
  patch: Partial<LoadRecord>,
): Promise<LoadRecord> {
  const id = loadId?.trim();
  if (!id) throw new LoadsApiError("loadId is required.", 400);
  const { body } = await request<{ load: LoadRecord }>(
    `${LOADS_ENDPOINT}/${encodeURIComponent(id)}`,
    { method: "PATCH", body: withoutServerOwnedFields(patch as Record<string, unknown>) },
  );
  if (!body?.load) throw new LoadsApiError("Update returned no record.", 502);
  return body.load;
}

export async function apiDeleteLoad(loadId: string): Promise<void> {
  const id = loadId?.trim();
  if (!id) throw new LoadsApiError("loadId is required.", 400);
  await request(`${LOADS_ENDPOINT}/${encodeURIComponent(id)}`, { method: "DELETE" });
}
