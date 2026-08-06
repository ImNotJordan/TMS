import { fetchUserAttributes, getCurrentUser } from "aws-amplify/auth";
import { QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";

import { fetchAdminDirectoryCached, prependAdminDirectoryCacheUser } from "./admin-users-cache";
import {
  formatStoredRole,
  roleToStorageKey,
} from "./admin-user-constants";
import {
  adminCreateCognitoUser,
  isCognitoAdminConfigured,
  listCognitoDirectoryUsers,
} from "./cognito-admin";
import { configureAmplify } from "./amplify";
import { getDynamoDocClient, getProfileTableName, isDynamoConfigured } from "./dynamodb";
import { putSection } from "./profile-store";
import { createRateLimitedExecutor } from "./rate-limit";

const ADMIN_DIRECTORY_READ_RATE_LIMIT_MS = 300;
const ADMIN_DIRECTORY_AUTH_RATE_LIMIT_MS = 600;
const runAdminReadLimited = createRateLimitedExecutor(ADMIN_DIRECTORY_READ_RATE_LIMIT_MS);
const runAdminAuthLimited = createRateLimitedExecutor(ADMIN_DIRECTORY_AUTH_RATE_LIMIT_MS);

type SectionData = Record<string, unknown>;

type ProfileSectionItem = {
  userId: string;
  section: string;
  data?: SectionData;
  updatedAt?: string;
};

export type AdminUserDirectoryEntry = {
  id: string;
  name?: string;
  email?: string;
  phone?: string;
  role?: string;
  department?: string;
  status?: string;
  team?: string;
  lastLogin?: string;
  inviteStatus?: string;
  twoFAStatus?: string;
  createdDate?: string;
};

export type CreateAdminUserPayload = {
  firstName: string;
  lastName: string;
  displayName?: string;
  email: string;
  phone?: string;
  jobTitle?: string;
  department?: string;
  officeBranch?: string;
  timeZone?: string;
  language?: string;
  role: string;
  permissionTemplate?: string;
  accessLevel?: string;
  assignedTeam?: string;
  assignedBranch?: string;
  dataAccessScope?: string;
  accountStatus: string;
  inviteStatus: string;
  twoFAStatus: string;
  modulePermissions?: Record<string, unknown>;
  fieldPermissions?: Record<string, unknown>;
  temporaryPassword?: string;
  sendEmailInvite?: boolean;
};

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeIsoDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const maybeDate = new Date(value);
  if (Number.isNaN(maybeDate.getTime())) return value;
  return maybeDate.toISOString();
}

function synthesizeName({
  givenName,
  familyName,
  nickname,
  email,
  fallbackId,
}: {
  givenName?: string;
  familyName?: string;
  nickname?: string;
  email?: string;
  fallbackId: string;
}): string {
  const full = [givenName, familyName].filter(Boolean).join(" ").trim();
  if (full) return full;
  if (nickname) return nickname;
  if (email) {
    const local = email.split("@")[0];
    if (local) return local;
  }
  return fallbackId;
}

function describeDynamoListError(err: unknown, op: string): Error {
  if (err instanceof Error) {
    const awsName = (err as { name?: string }).name;
    if (awsName === "AccessDeniedException") {
      return new Error(
        `Not authorized for DynamoDB ${op}. Add dynamodb:${op} on table ${getProfileTableName()} to your Identity Pool authenticated IAM role.`,
      );
    }
    const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    const detail = [awsName && `${awsName}`, status && `HTTP ${status}`, err.message]
      .filter(Boolean)
      .join(" · ");
    return new Error(`DynamoDB ${op} failed: ${detail}`);
  }
  return new Error(`DynamoDB ${op} failed`);
}

function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)) as T;
  }
  if (value && typeof value === "object") {
    const next: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (nested !== undefined) {
        next[key] = stripUndefinedDeep(nested);
      }
    }
    return next as T;
  }
  return value;
}

async function listUsersFromProfileTable(): Promise<AdminUserDirectoryEntry[]> {
  const client = await getDynamoDocClient();
  const tableName = getProfileTableName();

  const items: ProfileSectionItem[] = [];
  let cursor: Record<string, unknown> | undefined;

  try {
    do {
      const out = (await runAdminReadLimited(() =>
        client.send(
          new ScanCommand({
            TableName: tableName,
            ...(cursor ? { ExclusiveStartKey: cursor } : {}),
          }) as never,
        ),
      )) as { Items?: ProfileSectionItem[]; LastEvaluatedKey?: Record<string, unknown> };
      const page = out.Items ?? [];
      items.push(...page);
      cursor = out.LastEvaluatedKey;
    } while (cursor);
  } catch (err) {
    throw describeDynamoListError(err, "Scan");
  }

  return mapSectionItemsToUsers(items);
}

async function enrichDirectoryFromProfileTable(
  users: AdminUserDirectoryEntry[],
): Promise<AdminUserDirectoryEntry[]> {
  const enriched = await Promise.all(
    users.map(async (user) => {
      if (!user.id) return user;
      try {
        const fromTable = await getAdminDirectoryUserById(user.id);
        return fromTable ?? user;
      } catch {
        return user;
      }
    }),
  );
  return enriched;
}

async function listUsersFromCognitoAndProfile(): Promise<AdminUserDirectoryEntry[]> {
  const cognitoUsers = await runAdminAuthLimited(() => listCognitoDirectoryUsers());
  if (cognitoUsers.length === 0) return [];
  return enrichDirectoryFromProfileTable(cognitoUsers);
}

function mapSectionItemsToUsers(items: ProfileSectionItem[]): AdminUserDirectoryEntry[] {
  const byUser = new Map<
    string,
    {
      personal?: Record<string, unknown>;
      permissions?: Record<string, unknown>;
      security?: Record<string, unknown>;
      createdAt?: string;
      updatedAt?: string;
    }
  >();

  for (const item of items) {
    if (!item.userId) continue;
    const aggregate = byUser.get(item.userId) ?? {};
    const sectionData = toRecord(item.data);

    if (item.section === "personal") aggregate.personal = sectionData;
    if (item.section === "permissions") aggregate.permissions = sectionData;
    if (item.section === "security") aggregate.security = sectionData;

    const sectionUpdated = normalizeIsoDate(item.updatedAt);
    if (sectionUpdated) {
      if (!aggregate.createdAt || sectionUpdated < aggregate.createdAt) {
        aggregate.createdAt = sectionUpdated;
      }
      if (!aggregate.updatedAt || sectionUpdated > aggregate.updatedAt) {
        aggregate.updatedAt = sectionUpdated;
      }
    }

    byUser.set(item.userId, aggregate);
  }

  return Array.from(byUser.entries()).map(([userId, aggregate]) => {
    const personal = aggregate.personal ?? {};
    const permissions = aggregate.permissions ?? {};
    const security = aggregate.security ?? {};

    const givenName = asString(personal.given_name);
    const familyName = asString(personal.family_name);
    const nickname = asString(personal.nickname);
    const email = asString(personal.email);
    const role = formatStoredRole(asString(permissions.role));
    const department = asString(personal.department);
    const teams = asString(permissions.teams);
    const accountStatus = asString(security.accountStatus) ?? asString(permissions.status);
    const inviteStatus = asString(security.inviteStatus);
    const twoFactor =
      asString(security.twoFAStatus) ??
      asString(security.mfaStatus) ??
      asString(security.mfaPreference);
    const lastLogin = asString(security.lastLoginAt) ?? asString(security.lastLogin);

    return {
      id: userId,
      name: synthesizeName({ givenName, familyName, nickname, email, fallbackId: userId }),
      email,
      phone: asString(personal.phone_number) ?? asString(personal.mobile),
      role,
      department,
      status: accountStatus,
      team: teams ? teams.split(",")[0]?.trim() : undefined,
      lastLogin,
      inviteStatus,
      twoFAStatus: twoFactor,
      createdDate: aggregate.createdAt,
    } satisfies AdminUserDirectoryEntry;
  });
}

export async function getAdminDirectoryUserById(
  userId: string,
): Promise<AdminUserDirectoryEntry | null> {
  const client = await getDynamoDocClient();
  const tableName = getProfileTableName();
  const out = (await runAdminReadLimited(() =>
    client.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "userId = :u",
        ExpressionAttributeValues: { ":u": userId },
      }) as never,
    ),
  )) as { Items?: ProfileSectionItem[] };
  const items = out.Items ?? [];
  const mapped = mapSectionItemsToUsers(items);
  return mapped[0] ?? null;
}

async function buildCurrentCognitoUser(): Promise<AdminUserDirectoryEntry | null> {
  configureAmplify();
  try {
    const current = await runAdminAuthLimited(() => getCurrentUser());
    const attrs = await runAdminAuthLimited(() => fetchUserAttributes());
    const email = asString(attrs.email);
    const first = asString(attrs.given_name);
    const last = asString(attrs.family_name);
    const name = synthesizeName({
      givenName: first,
      familyName: last,
      nickname: asString(attrs.nickname),
      email,
      fallbackId: current.userId,
    });
    return {
      id: current.userId,
      name,
      email,
      phone: asString(attrs.phone_number),
      role: undefined,
      department: asString(attrs["custom:department"]),
      status: "Active",
      team: undefined,
      lastLogin: undefined,
      inviteStatus: "Accepted",
      twoFAStatus: undefined,
      createdDate: undefined,
    };
  } catch {
    return null;
  }
}

export async function createAdminDirectoryUser(
  payload: CreateAdminUserPayload,
): Promise<AdminUserDirectoryEntry> {
  if (!isDynamoConfigured()) {
    throw new Error(
      "DynamoDB is not configured. Set VITE_PROFILE_TABLE_NAME and VITE_COGNITO_IDENTITY_POOL_ID in .env.",
    );
  }
  if (!isCognitoAdminConfigured()) {
    throw new Error(
      "Cognito admin is not configured. Set VITE_COGNITO_USER_POOL_ID and VITE_COGNITO_IDENTITY_POOL_ID in .env.",
    );
  }

  const email = payload.email.trim().toLowerCase();
  if (!email) {
    throw new Error("Email is required.");
  }

  const firstName = payload.firstName.trim();
  const lastName = payload.lastName.trim();
  if (!firstName || !lastName) {
    throw new Error("First and last name are required.");
  }

  const cognitoUser = await runAdminAuthLimited(() =>
    adminCreateCognitoUser({
      email,
      firstName,
      lastName,
      displayName: payload.displayName,
      phone: payload.phone,
      department: payload.department,
      jobTitle: payload.jobTitle,
      temporaryPassword: payload.temporaryPassword,
      sendEmailInvite: payload.sendEmailInvite,
    }),
  );

  const userId = cognitoUser.userId;
  const now = new Date().toISOString();
  const storageRole = roleToStorageKey(payload.role);

  await putSection(userId, "personal", {
    given_name: firstName,
    family_name: lastName,
    nickname: payload.displayName?.trim() || undefined,
    email,
    phone_number: payload.phone?.trim() || undefined,
    job_title: payload.jobTitle?.trim() || undefined,
    department: payload.department?.trim() || undefined,
    zoneinfo: payload.timeZone?.trim() || undefined,
    locale: payload.language?.trim() || undefined,
    office_branch: payload.officeBranch?.trim() || undefined,
  });

  await putSection(
    userId,
    "permissions",
    stripUndefinedDeep({
      role: storageRole,
      permissionGroup: payload.permissionTemplate?.trim() || undefined,
      accessLevel: payload.accessLevel?.trim() || undefined,
      branch: payload.assignedBranch?.trim() || payload.officeBranch?.trim() || undefined,
      teams: payload.assignedTeam?.trim() || undefined,
      status: payload.accountStatus,
      dataAccessScope: payload.dataAccessScope?.trim() || undefined,
      modulePermissions: payload.modulePermissions,
      fieldPermissions: payload.fieldPermissions,
    }),
  );

  await putSection(userId, "security", {
    accountStatus: payload.accountStatus,
    inviteStatus: payload.inviteStatus,
    twoFAStatus: payload.twoFAStatus,
    createdAt: now,
  });

  return {
    id: userId,
    name: synthesizeName({
      givenName: firstName,
      familyName: lastName,
      nickname: payload.displayName?.trim(),
      email,
      fallbackId: userId,
    }),
    email,
    phone: payload.phone?.trim(),
    role: formatStoredRole(storageRole),
    department: payload.department?.trim(),
    status: payload.accountStatus,
    team: payload.assignedTeam?.trim(),
    inviteStatus: payload.inviteStatus,
    twoFAStatus: payload.twoFAStatus,
    createdDate: now,
  };
}

export async function listAdminDirectoryUsers(): Promise<{
  users: AdminUserDirectoryEntry[];
  source: "dynamodb" | "cognito";
  warning?: string;
}> {
  const scanEnabled =
    String(import.meta.env.VITE_ADMIN_USERS_TABLE_SCAN ?? "").toLowerCase() === "true";
  const current = await buildCurrentCognitoUser();

  if (isDynamoConfigured()) {
    if (scanEnabled) {
      try {
        const users = await listUsersFromCognitoAndProfile();
        if (users.length > 0) {
          return { users, source: "dynamodb" };
        }
      } catch (cognitoErr) {
        try {
          const users = await listUsersFromProfileTable();
          if (users.length > 0) {
            return { users, source: "dynamodb" };
          }
        } catch (scanErr) {
          const cognitoMessage =
            cognitoErr instanceof Error ? cognitoErr.message : "Could not list Cognito users";
          const scanMessage =
            scanErr instanceof Error ? scanErr.message : "Could not scan UsersTable";
          if (!current) {
            throw new Error(`${cognitoMessage}. ${scanMessage}`);
          }
          return {
            users: [current],
            source: "cognito",
            warning: `${cognitoMessage}. ${scanMessage}`,
          };
        }

        const message =
          cognitoErr instanceof Error ? cognitoErr.message : "Could not list Cognito users";
        if (!current) throw cognitoErr;
        return {
          users: [current],
          source: "cognito",
          warning: message,
        };
      }
    }

    if (current?.id) {
      try {
        const fromTable = await getAdminDirectoryUserById(current.id);
        if (fromTable) {
          return {
            users: [fromTable],
            source: "dynamodb",
          };
        }
      } catch (err) {
        if (!current) throw err;
        const message =
          err instanceof Error ? err.message : "Could not query current user from UsersTable";
        return {
          users: [current],
          source: "cognito",
          warning: message,
        };
      }
    }

    if (current) {
      return {
        users: [current],
        source: "cognito",
      };
    }

    const users = await listUsersFromProfileTable();
    if (users.length > 0) {
      return { users, source: "dynamodb" };
    }
    return { users: [], source: "dynamodb" };
  }

  if (current) {
    return {
      users: [current],
      source: "cognito",
    };
  }
  return { users: [], source: "cognito", warning: "No Cognito session found." };
}

/** Cached directory list — reuses session/memory until force refresh or sign-out. */
export async function listAdminDirectoryUsersCached(
  scope: string,
  options?: { force?: boolean },
) {
  return fetchAdminDirectoryCached({
    scope,
    force: options?.force,
    fetchRemote: listAdminDirectoryUsers,
  });
}

export function cacheAdminDirectoryUser(scope: string, user: AdminUserDirectoryEntry) {
  prependAdminDirectoryCacheUser(scope, user);
}

export type AssignableRoleKind = "dispatcher" | "driver" | "broker";

function matchesAssignableRole(
  role: string | undefined,
  kind: AssignableRoleKind,
): boolean {
  const normalized = (role ?? "").trim().toLowerCase();
  if (!normalized) return false;
  if (kind === "dispatcher") return normalized.includes("dispatch");
  if (kind === "broker") return normalized.includes("broker");
  return normalized.includes("driver");
}

function isAssignableAccountStatus(status: string | undefined): boolean {
  const normalized = (status ?? "Active").trim().toLowerCase();
  if (!normalized) return true;
  if (normalized.includes("deactiv")) return false;
  if (normalized.includes("suspend")) return false;
  if (normalized.includes("inactive")) return false;
  if (normalized.includes("lock")) return false;
  return true;
}

/**
 * Full directory fetch for load-assignment pickers (ignores admin scan gate).
 * Prefers Cognito ListUsers + profile enrich; falls back to profile table scan.
 */
async function fetchDirectoryForAssignment(): Promise<AdminUserDirectoryEntry[]> {
  if (isCognitoAdminConfigured()) {
    try {
      const users = await listUsersFromCognitoAndProfile();
      if (users.length > 0) return users;
    } catch {
      /* fall through to profile scan / current user */
    }
  }

  if (isDynamoConfigured()) {
    try {
      const users = await listUsersFromProfileTable();
      if (users.length > 0) return users;
    } catch {
      /* fall through */
    }
  }

  const current = await buildCurrentCognitoUser();
  return current ? [current] : [];
}

/** Users with Dispatcher / Driver / Broker role for Create Load ownership pickers. */
export async function listAssignableUsersByKind(): Promise<{
  dispatchers: AdminUserDirectoryEntry[];
  drivers: AdminUserDirectoryEntry[];
  brokers: AdminUserDirectoryEntry[];
}> {
  const users = await fetchDirectoryForAssignment();
  const byName = (a: AdminUserDirectoryEntry, b: AdminUserDirectoryEntry) =>
    (a.name ?? a.email ?? a.id).localeCompare(b.name ?? b.email ?? b.id, undefined, {
      sensitivity: "base",
    });

  const active = users.filter((u) => isAssignableAccountStatus(u.status));

  return {
    dispatchers: active.filter((u) => matchesAssignableRole(u.role, "dispatcher")).sort(byName),
    drivers: active.filter((u) => matchesAssignableRole(u.role, "driver")).sort(byName),
    brokers: active.filter((u) => matchesAssignableRole(u.role, "broker")).sort(byName),
  };
}
