import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

import { getDynamoDocClient, getProfileTableName, queryAllItems } from "./dynamodb";
import { createRateLimitedExecutor } from "./rate-limit";

const PROFILE_READ_RATE_LIMIT_MS = 300;
const PROFILE_WRITE_RATE_LIMIT_MS = 1200;
const runProfileReadLimited = createRateLimitedExecutor(PROFILE_READ_RATE_LIMIT_MS);
const runProfileWriteLimited = createRateLimitedExecutor(PROFILE_WRITE_RATE_LIMIT_MS);

export type SectionKey =
  | "personal"
  | "preferences"
  | "notifications"
  | "security"
  | "permissions"
  | "documents"
  | "integrations"
  | "company";

export type ProfileItem<T> = {
  userId: string;
  section: SectionKey;
  data: T;
  updatedAt: string;
};

function describeError(err: unknown, op: string): Error {
  if (err instanceof Error) {
    // AWS SDK errors carry a `name` like "AccessDeniedException" and sometimes
    // a `$metadata` blob; surface the most useful bits.
    const awsName = (err as { name?: string }).name;
    const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    const detail = [awsName && `${awsName}`, status && `HTTP ${status}`, err.message]
      .filter(Boolean)
      .join(" · ");
    console.error(`[DynamoDB ${op}]`, err);
    return new Error(`DynamoDB ${op} failed: ${detail}`);
  }
  console.error(`[DynamoDB ${op}]`, err);
  return new Error(`DynamoDB ${op} failed`);
}

export type SectionLoadResult<T> = {
  data: T | null;
  updatedAt: string | null;
};

/**
 * Fields inside the `permissions` section that confer privilege.
 *
 * `rbac.ts` reads `role`, `adminAccess` and `modulePermissions` to decide what a
 * user may see and do, so anything that can write them is a privilege-escalation
 * path. They are administered on another user's behalf, never self-served.
 *
 * `companyId`/`companyName` are here for the same reason: the company is the
 * tenant key every record is stamped and filtered by, so a user who could set
 * their own would be choosing whose data they see. Assignment is an admin
 * action — see `createAdminDirectoryUser` and `assignUserCompany`.
 */
const PRIVILEGED_PERMISSION_FIELDS: ReadonlySet<string> = new Set([
  "role",
  "adminAccess",
  "accessLevel",
  "permissionGroup",
  "dataAccessScope",
  "modulePermissions",
  "fieldPermissions",
  "companyId",
  "companyName",
]);

export type SanitizedSectionPayload = {
  data: Record<string, unknown>;
  /** Privileged keys the caller tried to write. Empty on a normal save. */
  rejected: string[];
};

/**
 * Strip privilege-bearing fields from a self-service profile write.
 *
 * Rejected rather than silently dropped: a save that carries `role` is either a
 * UI wiring mistake or an escalation attempt, and both need to be visible.
 */
export function sanitizeSelfServiceSection(
  section: SectionKey,
  data: Record<string, unknown>,
): SanitizedSectionPayload {
  if (section !== "permissions") return { data, rejected: [] };

  const sanitized: Record<string, unknown> = {};
  const rejected: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (PRIVILEGED_PERMISSION_FIELDS.has(key)) rejected.push(key);
    else sanitized[key] = value;
  }
  return { data: sanitized, rejected };
}

/**
 * Self-service profile write — the only path the signed-in user's own UI may use.
 *
 * `userId` is the caller's own id supplied by the auth context, and privileged
 * fields are stripped before the write.
 *
 * NOTE: this is a correctness and accident guard, not a security boundary. The
 * browser holds Identity Pool credentials with direct DynamoDB access, so a
 * determined caller can still issue a raw PutItem against any user's row. That
 * closes only when the Profile table is taken away from the browser's IAM role
 * and writes move behind a server endpoint. See docs/security/stage-0-iam.md.
 */
export async function putOwnSection(
  userId: string,
  section: SectionKey,
  data: Record<string, unknown>,
  options?: { merge?: boolean },
): Promise<Record<string, unknown>> {
  const { data: sanitized, rejected } = sanitizeSelfServiceSection(section, data);

  if (rejected.length > 0) {
    // Security event: a self-service surface tried to write its own privilege.
    console.error("[security] blocked self-service write to privileged fields", {
      userId,
      section,
      fields: rejected,
    });
  }

  if (options?.merge) return putSectionMerge(userId, section, sanitized);
  await putSection(userId, section, sanitized);
  return sanitized;
}

export async function getSection<T = Record<string, unknown>>(
  userId: string,
  section: SectionKey,
): Promise<SectionLoadResult<T>> {
  return runProfileReadLimited(async () => {
    try {
      const client = await getDynamoDocClient();
      const out = await client.send(
        new GetCommand({
          TableName: getProfileTableName(),
          Key: { userId, section },
        }),
      );
      const item = out.Item as ProfileItem<T> | undefined;
      return {
        data: (item?.data ?? null) as T | null,
        updatedAt: item?.updatedAt ?? null,
      };
    } catch (err) {
      throw describeError(err, "GetItem");
    }
  });
}

/**
 * Privileged write — may target ANY user's row and set ANY field, including
 * `permissions.role`. Reserved for admin flows (`admin-user-edit`,
 * `admin-users-store`). Self-service UI must call `putOwnSection` instead.
 *
 * The admin/non-admin distinction is currently unenforced: the caller is the
 * browser and there is no server to check the caller's role. Treat every call
 * site as if it were reachable by any signed-in user, because it is.
 */
export async function putSection<T = Record<string, unknown>>(
  userId: string,
  section: SectionKey,
  data: T,
): Promise<void> {
  return runProfileWriteLimited(async () => {
    try {
      const client = await getDynamoDocClient();
      await client.send(
        new PutCommand({
          TableName: getProfileTableName(),
          Item: {
            userId,
            section,
            data,
            updatedAt: new Date().toISOString(),
          } satisfies ProfileItem<T>,
        }),
      );
    } catch (err) {
      throw describeError(err, "PutItem");
    }
  });
}

/**
 * Merge `patch` into the existing section document so partial UIs
 * (e.g. Profile → Role & Permissions) cannot wipe RBAC matrices.
 */
export async function putSectionMerge(
  userId: string,
  section: SectionKey,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const existing = await getSection<Record<string, unknown>>(userId, section);
  const base =
    existing.data && typeof existing.data === "object" && !Array.isArray(existing.data)
      ? existing.data
      : {};
  const merged = { ...base, ...patch };
  await putSection(userId, section, merged);
  return merged;
}

export async function getAllSections(
  userId: string,
): Promise<Partial<Record<SectionKey, unknown>>> {
  return runProfileReadLimited(async () => {
    try {
      const client = await getDynamoDocClient();
      const items = await queryAllItems<ProfileItem<unknown>>(client, {
        TableName: getProfileTableName(),
        KeyConditionExpression: "userId = :u",
        ExpressionAttributeValues: { ":u": userId },
      });
      const map: Partial<Record<SectionKey, SectionLoadResult<unknown>>> = {};
      for (const item of items) {
        map[item.section] = {
          data: item.data ?? null,
          updatedAt: item.updatedAt ?? null,
        };
      }
      return map;
    } catch (err) {
      throw describeError(err, "Query");
    }
  });
}
