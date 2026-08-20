/**
 * Driver Loads transport — HTTP to `/api/driver/loads`, not DynamoDB.
 *
 * The portal no longer holds credentials for the Loads table. It asks the
 * server, which derives the driver from the verified token and scopes every
 * query to `assignedDriver = <their sub>`.
 *
 * The field allowlist still exists on the server; the copy that used to live in
 * this app was advice a determined caller could edit out. Sending a
 * non-driver field now earns a 403 from the server rather than a silent write.
 */
import { fetchAuthSession } from "aws-amplify/auth";

import { apiUrl } from "./api-base";
import type { DriverLoadRecord } from "./aws-loads";

const DRIVER_LOADS_ENDPOINT = "/api/driver/loads";

export class DriverLoadsApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "DriverLoadsApiError";
    this.status = status;
    this.code = code;
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

async function request<T>(
  path: string,
  init: Omit<RequestInit, "body"> & { body?: unknown } = {},
): Promise<T | null> {
  const { body, ...rest } = init;
  const response = await fetch(apiUrl(path), {
    ...rest,
    headers: {
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(await authHeaders()),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const parsed = (await response.json().catch(() => null)) as
    | (T & { error?: string; code?: string })
    | null;

  if (!response.ok) {
    throw new DriverLoadsApiError(
      parsed?.error ?? `Request failed (HTTP ${response.status}).`,
      response.status,
      parsed?.code,
    );
  }
  return parsed;
}

/** Loads assigned to the signed-in driver. */
export async function apiListDriverLoads(): Promise<DriverLoadRecord[]> {
  const body = await request<{ loads: DriverLoadRecord[] }>(DRIVER_LOADS_ENDPOINT);
  return body?.loads ?? [];
}

/** `null` when the load does not exist *or* is not assigned to this driver. */
export async function apiGetDriverLoad(loadId: string): Promise<DriverLoadRecord | null> {
  const id = loadId?.trim();
  if (!id) return null;
  try {
    const body = await request<{ load: DriverLoadRecord }>(
      `${DRIVER_LOADS_ENDPOINT}/${encodeURIComponent(id)}`,
    );
    return body?.load ?? null;
  } catch (err) {
    if (err instanceof DriverLoadsApiError && err.status === 404) return null;
    throw err;
  }
}

/**
 * Write the driver-owned attributes of an assigned load.
 *
 * The server rejects any other field and any load that is not theirs; this
 * simply passes the patch through.
 */
export async function apiPatchDriverLoad(
  loadId: string,
  attributes: Partial<DriverLoadRecord>,
): Promise<DriverLoadRecord> {
  const id = loadId?.trim();
  if (!id) throw new DriverLoadsApiError("loadId is required.", 400);
  const body = await request<{ load: DriverLoadRecord }>(
    `${DRIVER_LOADS_ENDPOINT}/${encodeURIComponent(id)}`,
    { method: "PATCH", body: attributes },
  );
  if (!body?.load) throw new DriverLoadsApiError("Update returned no record.", 502);
  return body.load;
}
