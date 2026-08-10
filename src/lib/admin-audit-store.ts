import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

import type { AuthUser } from "@/lib/auth";
import { getDynamoDocClient, getProfileTableName, isDynamoConfigured } from "@/lib/dynamodb";
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

export async function listAdminAuditLogs(options?: {
  limit?: number;
}): Promise<AdminAuditLogEntry[]> {
  if (!isDynamoConfigured()) {
    return readAdminAuditLogsCache();
  }

  const client = await getDynamoDocClient();
  const tableName = getProfileTableName();
  const items: AdminAuditLogEntry[] = [];
  let cursor: Record<string, unknown> | undefined;

  do {
    const out = (await runAuditReadLimited(() =>
      client.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: "userId = :u",
          ExpressionAttributeValues: { ":u": ADMIN_AUDIT_USER_ID },
          ...(cursor ? { ExclusiveStartKey: cursor } : {}),
        }) as never,
      ),
    )) as {
      Items?: Array<{ section?: string; data?: unknown; updatedAt?: string }>;
      LastEvaluatedKey?: Record<string, unknown>;
    };

    for (const item of out.Items ?? []) {
      const fromData = normalizeEntry(item.data);
      if (fromData) {
        items.push(fromData);
        continue;
      }
      if (item.section?.startsWith("log-") && item.updatedAt) {
        items.push({
          id: item.section,
          when: item.updatedAt,
          actorUserId: "unknown",
          actorName: "Unknown",
          action: "Action",
          module: "Admin",
          record: "—",
          status: "Success",
          details: "",
        });
      }
    }

    cursor = out.LastEvaluatedKey;
  } while (cursor);

  const sorted = sortNewestFirst(items);
  setMemoryLogs(sorted);
  const limit = options?.limit ?? 500;
  return sorted.slice(0, limit);
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
  const entry: AdminAuditLogEntry = {
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

  prependAdminAuditLogsCache(entry);

  if (!isDynamoConfigured()) {
    return entry;
  }

  await runAuditWriteLimited(async () => {
    const client = await getDynamoDocClient();
    await client.send(
      new PutCommand({
        TableName: getProfileTableName(),
        Item: {
          userId: ADMIN_AUDIT_USER_ID,
          section: entry.id,
          data: entry,
          updatedAt: entry.when,
        },
      }),
    );
  });

  return entry;
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
