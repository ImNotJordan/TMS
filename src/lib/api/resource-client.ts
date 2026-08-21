/**
 * Client transport for the tenant-scoped resource API.
 *
 * `createResourceClient("trucks", …)` returns the same five operations every
 * store needs, talking to `/api/trucks`. Each store keeps its existing exported
 * names and signatures and simply delegates — so screens never learn that the
 * transport changed.
 *
 * ## Server-owned fields are stripped on the way out
 *
 * The API returns 400 for a payload carrying `companyId`, `createdBy`,
 * `createdAt` or `updatedAt` — deliberately, so an attempt is visible rather
 * than silently dropped. But an editor screen legitimately holds a whole record
 * that already has those fields, and sending it back on save is the obvious
 * thing to do, not an attack. So this strips them; the server's rejection stays
 * as the backstop for anything that is not this client.
 */
import { fetchAuthSession } from "aws-amplify/auth";

const SERVER_OWNED_FIELDS = ["companyId", "createdBy", "createdAt", "updatedAt"] as const;

export class ResourceApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ResourceApiError";
    this.status = status;
    this.code = code;
  }

  /** The caller has no company yet — prompt, do not retry. */
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

function withoutServerOwnedFields(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if ((SERVER_OWNED_FIELDS as readonly string[]).includes(key)) continue;
    if (value === undefined) continue;
    out[key] = value;
  }
  return out;
}

/**
 * One authenticated JSON round trip against the API tier.
 *
 * Exported because endpoints whose shape does not fit the five-operation CRUD
 * contract below — `/api/inventory/movements` returns a movement *and* the item
 * it moved — still need identical auth, error and 204 handling. Reimplementing
 * that per endpoint is how one of them ends up not attaching the token.
 */
export async function sendResourceRequest<T>(
  path: string,
  init: Omit<RequestInit, "body"> & { body?: unknown } = {},
): Promise<T | null> {
  const { body, ...rest } = init;
  const response = await fetch(path, {
    ...rest,
    headers: {
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(await authHeaders()),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  if (response.status === 204) return null;

  const parsed = (await response.json().catch(() => null)) as
    | (T & { error?: string; code?: string })
    | null;

  if (!response.ok) {
    throw new ResourceApiError(
      parsed?.error ?? `Request failed (HTTP ${response.status}).`,
      response.status,
      parsed?.code,
    );
  }
  return parsed;
}

const send = sendResourceRequest;

export type ResourceClient<T> = {
  list(): Promise<T[]>;
  /** `null` for a record that does not exist *or* belongs to another company. */
  get(id: string): Promise<T | null>;
  create(input: Record<string, unknown>): Promise<T>;
  update(id: string, patch: Record<string, unknown>): Promise<T>;
  remove(id: string): Promise<void>;
};

/**
 * @param resource URL segment, matching a `resource-registry` entry.
 * @param keys     Response envelope keys the server uses for this resource.
 */
export function createResourceClient<T>(
  resource: string,
  keys: { collection: string; item: string },
): ResourceClient<T> {
  const base = `/api/${resource}`;
  const itemPath = (id: string) => `${base}/${encodeURIComponent(id)}`;

  return {
    async list() {
      const body = await send<Record<string, T[]>>(base);
      return body?.[keys.collection] ?? [];
    },

    async get(id) {
      const trimmed = id?.trim();
      if (!trimmed) return null;
      try {
        const body = await send<Record<string, T>>(itemPath(trimmed));
        return body?.[keys.item] ?? null;
      } catch (err) {
        if (err instanceof ResourceApiError && err.status === 404) return null;
        throw err;
      }
    },

    async create(input) {
      const body = await send<Record<string, T>>(base, {
        method: "POST",
        body: withoutServerOwnedFields(input),
      });
      const created = body?.[keys.item];
      if (!created) throw new ResourceApiError("Create returned no record.", 502);
      return created;
    },

    async update(id, patch) {
      const trimmed = id?.trim();
      if (!trimmed) throw new ResourceApiError("An id is required.", 400);
      const body = await send<Record<string, T>>(itemPath(trimmed), {
        method: "PATCH",
        body: withoutServerOwnedFields(patch),
      });
      const updated = body?.[keys.item];
      if (!updated) throw new ResourceApiError("Update returned no record.", 502);
      return updated;
    },

    async remove(id) {
      const trimmed = id?.trim();
      if (!trimmed) throw new ResourceApiError("An id is required.", 400);
      await send(itemPath(trimmed), { method: "DELETE" });
    },
  };
}
