import { fetchUserAttributes, getCurrentUser } from "aws-amplify/auth";
import { QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";

import { configureAmplify } from "./amplify";
import { getDynamoDocClient, getProfileTableName, isDynamoConfigured } from "./dynamodb";
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

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function formatRole(role: string | undefined): string | undefined {
  if (!role) return undefined;
  const normalized = role.toLowerCase();
  if (normalized === "admin") return "Admin";
  if (normalized === "ops") return "Operations Manager";
  if (normalized === "dispatch") return "Dispatcher";
  if (normalized === "broker") return "Broker";
  if (normalized === "driver") return "Driver";
  return role;
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

async function listUsersFromProfileTable(): Promise<AdminUserDirectoryEntry[]> {
  const client = await getDynamoDocClient();
  const tableName = getProfileTableName();

  const items: ProfileSectionItem[] = [];
  let cursor: Record<string, unknown> | undefined;

  do {
    const out = await runAdminReadLimited(() =>
      client.send(
        new ScanCommand({
          TableName: tableName,
          ExclusiveStartKey: cursor as never,
        }),
      ),
    );
    const page = (out.Items as ProfileSectionItem[] | undefined) ?? [];
    items.push(...page);
    cursor = out.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (cursor);

  return mapSectionItemsToUsers(items);
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
    const role = formatRole(asString(permissions.role));
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

async function queryCurrentUserFromProfileTable(
  userId: string,
): Promise<AdminUserDirectoryEntry | null> {
  const client = await getDynamoDocClient();
  const tableName = getProfileTableName();
  const out = await runAdminReadLimited(() =>
    client.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "userId = :u",
        ExpressionAttributeValues: { ":u": userId },
      }),
    ),
  );
  const items = (out.Items as ProfileSectionItem[] | undefined) ?? [];
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
        const users = await listUsersFromProfileTable();
        if (users.length > 0) {
          return { users, source: "dynamodb" };
        }
      } catch (err) {
        if (!current) throw err;
        return {
          users: [current],
          source: "cognito",
        };
      }
    }

    if (current?.id) {
      try {
        const fromTable = await queryCurrentUserFromProfileTable(current.id);
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
