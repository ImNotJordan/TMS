/**
 * The administrative audit trail.
 *
 * ## Transport
 *
 * `/api/admin/audit`, not DynamoDB. Three things were wrong with reaching the
 * table directly, and all three were security problems rather than style:
 *
 * 1. Entries live in `UsersTable`, on which the browser held `DeleteItem`. The
 *    record that exists to catch abuse could be erased by whoever it named.
 * 2. `actorUserId` and `actorName` were sent by the client, so an entry could
 *    name anyone. The server takes them from the verified token now and ignores
 *    what the body claims.
 * 3. Every entry shared the partition key `"ADMIN#audit"`, so each company's
 *    admins read every other company's history. Entries are partitioned per
 *    company server-side.
 *
 * The `actor` argument survives on `recordAdminAuditLog` so call sites did not
 * have to change, but only its display name is honoured.
 */
import { fetchAuthSession } from "aws-amplify/auth";

import type { AuthUser } from "@/lib/auth";
import { createRateLimitedExecutor } from "@/lib/rate-limit";
import type { AdminUserEditDraft } from "@/lib/admin-user-edit";

const AUDIT_READ_RATE_LIMIT_MS = 300;
const AUDIT_WRITE_RATE_LIMIT_MS = 600;
const runAuditReadLimited = createRateLimitedExecutor(AUDIT_READ_RATE_LIMIT_MS);
const runAuditWriteLimited = createRateLimitedExecutor(AUDIT_WRITE_RATE_LIMIT_MS);

/** Fixed partition key for org-wide admin audit entries in UsersTable. */
export const ADMIN_AUDIT_USER_ID = "ADMIN#audit";

export type AdminAuditStatus = "Success" | "Blocked" | "Reviewed" | "Failed";

export type AdminAuditLogEntry = {
  id: string;
  when: string;
  actorUserId: string;
  actorName: string;
  action: string;
  module: string;
  record: string;
  ip?: string;
  device?: string;
  status: AdminAuditStatus;
  details: string;
};

export type AdminAuditActor = {
  actorUserId: string;
  actorName: string;
};

const memoryLogs: AdminAuditLogEntry[] = [];
let memoryLoaded = false;

function newAuditId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `log-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `log-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function formatAuditWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function auditActorFromAuth(user: AuthUser | null | undefined): AdminAuditActor {
  const name =
    user?.name?.trim() || user?.attributes?.given_name || user?.email?.split("@")[0] || "Unknown";
  return {
    actorUserId: user?.userId ?? "unknown",
    actorName: name,
  };
}

export function getClientAuditDevice(): string {
  if (typeof navigator === "undefined") return "Unknown";
  const ua = navigator.userAgent;
  if (ua.includes("Edg/")) return "Edge";
  if (ua.includes("Chrome/")) return "Chrome";
  if (ua.includes("Firefox/")) return "Firefox";
  if (ua.includes("Safari/") && !ua.includes("Chrome")) return "Safari";
  return "Browser";
}

function normalizeEntry(raw: unknown): AdminAuditLogEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id : "";
  const when = typeof row.when === "string" ? row.when : "";
  if (!id || !when) return null;
  return {
    id,
    when,
    actorUserId: typeof row.actorUserId === "string" ? row.actorUserId : "unknown",
    actorName: typeof row.actorName === "string" ? row.actorName : "Unknown",
    action: typeof row.action === "string" ? row.action : "Action",
    module: typeof row.module === "string" ? row.module : "Admin",
    record: typeof row.record === "string" ? row.record : "—",
    ip: typeof row.ip === "string" ? row.ip : undefined,
    device: typeof row.device === "string" ? row.device : undefined,
    status:
      row.status === "Blocked" ||
      row.status === "Reviewed" ||
      row.status === "Failed" ||
      row.status === "Success"
        ? row.status
        : "Success",
    details: typeof row.details === "string" ? row.details : "",
  };
}

function sortNewestFirst(entries: AdminAuditLogEntry[]) {
  return [...entries].sort((a, b) => b.when.localeCompare(a.when));
}

function setMemoryLogs(entries: AdminAuditLogEntry[]) {
  memoryLogs.length = 0;
  memoryLogs.push(...sortNewestFirst(entries));
  memoryLoaded = true;
}

export function readAdminAuditLogsCache(): AdminAuditLogEntry[] {
  return [...memoryLogs];
}

export function prependAdminAuditLogsCache(entry: AdminAuditLogEntry) {
  memoryLogs.unshift(entry);
  memoryLoaded = true;
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

const AUDIT_PATH = "/api/admin/audit";

export async function listAdminAuditLogs(options?: {
  limit?: number;
}): Promise<AdminAuditLogEntry[]> {
  return runAuditReadLimited(async () => {
    const limit = options?.limit ?? 500;
    const response = await fetch(`${AUDIT_PATH}?limit=${limit}`, {
      headers: { Accept: "application/json", ...(await authHeaders()) },
    });

    // A non-admin has no audit trail to show. An empty list is the honest
    // answer and keeps the panel from erroring for ordinary users.
    if (response.status === 403 || response.status === 401) return readAdminAuditLogsCache();
    if (!response.ok) {
      throw new Error(`Could not load the audit trail (HTTP ${response.status}).`);
    }

    const body = (await response.json()) as { entries?: AdminAuditLogEntry[] };
    const sorted = sortNewestFirst(body.entries ?? []);
    setMemoryLogs(sorted);
    return sorted.slice(0, limit);
  });
}

export async function fetchAdminAuditLogsCached(options?: {
  force?: boolean;
}): Promise<AdminAuditLogEntry[]> {
  if (memoryLoaded && memoryLogs.length > 0 && !options?.force) {
    return readAdminAuditLogsCache();
  }

  try {
    return await listAdminAuditLogs();
  } catch {
    return readAdminAuditLogsCache();
  }
}

export async function recordAdminAuditLog(input: {
  actor: AdminAuditActor;
  action: string;
  module?: string;
  record: string;
  status?: AdminAuditStatus;
  details: string;
  ip?: string;
  device?: string;
}): Promise<AdminAuditLogEntry> {
  const optimistic: AdminAuditLogEntry = {
    id: newAuditId(),
    when: new Date().toISOString(),
    actorUserId: input.actor.actorUserId,
    actorName: input.actor.actorName,
    action: input.action,
    module: input.module ?? "Admin",
    record: input.record,
    ip: input.ip,
    device: input.device ?? getClientAuditDevice(),
    status: input.status ?? "Success",
    details: input.details,
  };

  return runAuditWriteLimited(async () => {
    const response = await fetch(AUDIT_PATH, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "content-type": "application/json",
        ...(await authHeaders()),
      },
      body: JSON.stringify({
        action: input.action,
        module: input.module,
        record: input.record,
        status: input.status,
        details: input.details,
        // Display name only. The server stamps the real identity, the id and
        // the source IP from the request it can see.
        actorName: input.actor.actorName,
        device: input.device ?? getClientAuditDevice(),
      }),
    });

    if (!response.ok) {
      // An audit write must never break the action it records, but it must not
      // be silent either — a missing entry is exactly what an attacker wants.
      console.error(`[audit] failed to record entry (HTTP ${response.status})`, input.action);
      prependAdminAuditLogsCache(optimistic);
      return optimistic;
    }

    const body = (await response.json()) as { entry?: AdminAuditLogEntry };
    const entry = body.entry ?? optimistic;
    prependAdminAuditLogsCache(entry);
    return entry;
  });
}

export function summarizeUserEditDiff(
  before: AdminUserEditDraft,
  after: AdminUserEditDraft,
): string {
  const parts: string[] = [];

  const push = (label: string, from: string, to: string) => {
    if (from.trim() !== to.trim())
      parts.push(`${label}: ${from.trim() || "—"} → ${to.trim() || "—"}`);
  };

  push("Name", `${before.firstName} ${before.lastName}`, `${after.firstName} ${after.lastName}`);
  push("Email", before.email, after.email);
  push("Phone", before.phone, after.phone);
  push("Role", before.role, after.role);
  push("Department", before.department, after.department);
  push("Team", before.assignedTeam, after.assignedTeam);
  push("Branch", before.assignedBranch, after.assignedBranch);
  push("Data scope", before.dataAccessScope, after.dataAccessScope);
  push("Account status", before.accountStatus, after.accountStatus);
  push("Invite status", before.inviteStatus, after.inviteStatus);
  push("2FA", before.twoFAStatus, after.twoFAStatus);

  if (before.permissionTemplate !== after.permissionTemplate) {
    parts.push(`Template: ${before.permissionTemplate} → ${after.permissionTemplate}`);
  }

  return parts.length > 0 ? parts.join("; ") : "User profile and permissions updated";
}

export function clearAdminAuditLogsCache() {
  memoryLogs.length = 0;
  memoryLoaded = false;
}
