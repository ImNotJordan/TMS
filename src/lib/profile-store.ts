/**
 * Profile sections.
 *
 * ## Transport
 *
 * `/api/profile`, not DynamoDB. The browser holds no credentials for the
 * profile table.
 *
 * The self-service sanitizer used to run here, and the comment above it was
 * honest about what that was worth: an accident guard, not a boundary, because
 * the browser could issue a raw `PutItem` against any user's row instead. The
 * sanitizer now runs on the server, and the table is off the Identity Pool
 * role, so it finally means something.
 *
 * ## Who the server thinks you are
 *
 * `userId` is still a parameter on these functions, but it is no longer trusted.
 * The server compares it against the token: your own id is self-service, anyone
 * else's requires an admin role *and* that they are in your company. Passing a
 * colleague's id returns 404 unless you are entitled to it.
 *
 * Exported names and signatures are unchanged so no screen moved.
 */
import { fetchAuthSession } from "aws-amplify/auth";

import { createRateLimitedExecutor } from "./rate-limit";
import {
  sanitizeSelfServiceSection,
  type SectionKey,
  type SectionLoadResult,
} from "./profile-schema";

export type {
  ProfileItem,
  SanitizedSectionPayload,
  SectionKey,
  SectionLoadResult,
} from "./profile-schema";
export { sanitizeSelfServiceSection } from "./profile-schema";

const PATH = "/api/profile";
const PROFILE_READ_RATE_LIMIT_MS = 300;
const PROFILE_WRITE_RATE_LIMIT_MS = 1200;
const runProfileReadLimited = createRateLimitedExecutor(PROFILE_READ_RATE_LIMIT_MS);
const runProfileWriteLimited = createRateLimitedExecutor(PROFILE_WRITE_RATE_LIMIT_MS);

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
    headers: {
      Accept: "application/json",
      ...headers,
      ...(init?.body ? { "content-type": "application/json" } : {}),
    },
  });
}

async function failure(response: Response, op: string): Promise<Error> {
  let message = `Profile ${op} failed (HTTP ${response.status})`;
  try {
    const body = (await response.json()) as { error?: string };
    if (body?.error) message = body.error;
  } catch {
    /* non-JSON error body — the status line is enough */
  }
  console.error(`[Profile ${op}]`, message);
  return new Error(message);
}

export async function getSection<T = Record<string, unknown>>(
  userId: string,
  section: SectionKey,
): Promise<SectionLoadResult<T>> {
  return runProfileReadLimited(async () => {
    const query = `userId=${encodeURIComponent(userId)}&section=${encodeURIComponent(section)}`;
    const response = await send(`${PATH}?${query}`);
    // Not yours and not administrable reads the same as absent — the caller
    // gets an empty section either way, and cannot tell them apart.
    if (response.status === 404) return { data: null, updatedAt: null };
    if (!response.ok) throw await failure(response, "GetItem");
    const body = (await response.json()) as { data?: T; updatedAt?: string };
    return { data: body.data ?? null, updatedAt: body.updatedAt ?? null };
  });
}

export async function getAllSections(
  userId: string,
): Promise<Array<{ section: string; data: unknown; updatedAt?: string }>> {
  return runProfileReadLimited(async () => {
    const response = await send(`${PATH}?userId=${encodeURIComponent(userId)}`);
    if (response.status === 404) return [];
    if (!response.ok) throw await failure(response, "Query");
    const body = (await response.json()) as {
      sections?: Array<{ section: string; data: unknown; updatedAt?: string }>;
    };
    return body.sections ?? [];
  });
}

async function writeSection(
  userId: string,
  section: SectionKey,
  data: Record<string, unknown>,
  options?: { merge?: boolean },
): Promise<Record<string, unknown>> {
  return runProfileWriteLimited(async () => {
    const response = await send(PATH, {
      method: "PUT",
      body: JSON.stringify({ userId, section, data, ...(options?.merge ? { merge: true } : {}) }),
    });
    if (!response.ok) throw await failure(response, "PutItem");
    const body = (await response.json()) as { data?: Record<string, unknown> };
    return body.data ?? data;
  });
}

/**
 * Administrative write to a user's section.
 *
 * The name is now slightly generous: the server decides whether this is an
 * admin write or a self-service one by comparing `userId` to the token, and
 * applies the sanitizer in the second case. There is no longer a client-side
 * distinction to get wrong.
 */
export async function putSection<T = Record<string, unknown>>(
  userId: string,
  section: SectionKey,
  data: T,
): Promise<void> {
  await writeSection(userId, section, data as Record<string, unknown>);
}

export async function putSectionMerge(
  userId: string,
  section: SectionKey,
  data: Record<string, unknown>,
): Promise<void> {
  await writeSection(userId, section, data, { merge: true });
}

/**
 * Self-service profile write.
 *
 * Still sanitizes locally, so a mis-wired form fails fast with a clear console
 * error rather than a 403 round-trip. The server sanitizes again and that copy
 * is the one that counts — this one is a convenience, and is allowed to be.
 */
export async function putOwnSection(
  userId: string,
  section: SectionKey,
  data: Record<string, unknown>,
  options?: { merge?: boolean },
): Promise<Record<string, unknown>> {
  const { data: sanitized, rejected } = sanitizeSelfServiceSection(section, data);

  if (rejected.length > 0) {
    console.error("[security] blocked self-service write to privileged fields", {
      userId,
      section,
      fields: rejected,
    });
  }

  return writeSection(userId, section, sanitized, options);
}
