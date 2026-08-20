import { fetchAuthSession, fetchUserAttributes, getCurrentUser } from "aws-amplify/auth";

import { fetchAdminDirectoryCached, prependAdminDirectoryCacheUser } from "./admin-users-cache";
import { formatStoredRole, normalizeRole, roleToStorageKey } from "./admin-user-constants";
import { adminCreateCognitoUser, isCognitoAdminConfigured } from "./cognito-admin";
import { configureAmplify } from "./amplify";
import { isDynamoConfigured } from "./dynamodb";
import { getAllSections, putSection, putSectionMerge } from "./profile-store";
import { createRateLimitedExecutor } from "./rate-limit";
import { ensureCompanyContext } from "./tenant/company-context";
import { TENANT_EXEMPT_ROLES } from "./tenant/server-tenant-context";

const ADMIN_DIRECTORY_READ_RATE_LIMIT_MS = 300;
const ADMIN_DIRECTORY_AUTH_RATE_LIMIT_MS = 600;
const runAdminReadLimited = createRateLimitedExecutor(ADMIN_DIRECTORY_READ_RATE_LIMIT_MS);
const runAdminAuthLimited = createRateLimitedExecutor(ADMIN_DIRECTORY_AUTH_RATE_LIMIT_MS);

/** Cognito bearer for the server admin routes. */
async function getServerAuthHeaders(): Promise<Record<string, string>> {
  try {
    const session = await fetchAuthSession();
    const token = session.tokens?.idToken?.toString();
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

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
  /** Tenant assignment. Set by an admin at creation; never self-served. */
  companyId?: string;
  companyName?: string;
  /**
   * Employer, for tenant-exempt roles (Drivers). Profile-only, never a token
   * claim — see [[directory-scope]]. Rule B is unchanged: a Driver still has no
   * `companyId`, so `requireCompanyId` still fails closed for them.
   */
  employerCompanyId?: string;
  employerCompanyName?: string;
};

/** A company an admin may assign to, derived from users already in the directory. */
export type KnownCompany = {
  companyId: string;
  companyName: string;
  userCount: number;
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
  /**
   * Tenant assignment for the new user. Required for every role except the
   * tenant-exempt ones (Driver), which are scoped by assignment instead.
   */
  companyId?: string;
  companyName?: string;
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
        `Not authorized for ${op}.`,
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

/**
 * The directory, from the server.
 *
 * Replaces two browser-side readers: a Cognito `ListUsers` over the whole pool,
 * and a `Scan` of the Profile table as fallback. Both pulled every user into the
 * browser and scoped afterwards in JavaScript, which is a presentation choice
 * rather than a boundary. The server now returns only rows this caller may see.
 */
async function fetchDirectoryFromApi(options?: {
  allCompanies?: boolean;
}): Promise<DirectoryResult> {
  const query = options?.allCompanies ? "?scope=all" : "";
  const response = await fetch(`/api/admin/users${query}`, {
    headers: { Accept: "application/json", ...(await getServerAuthHeaders()) },
  });

  const body = (await response.json().catch(() => null)) as {
    users?: AdminUserDirectoryEntry[];
    warning?: string;
    error?: string;
    scope?: "platform" | "company";
    companyCount?: number;
    canViewAllCompanies?: boolean;
  } | null;

  if (!response.ok) {
    throw new Error(body?.error ?? `Could not load the user directory (HTTP ${response.status}).`);
  }

  return {
    users: body?.users ?? [],
    source: "server",
    ...(body?.warning ? { warning: body.warning } : {}),
    ...(body?.scope ? { scope: body.scope } : {}),
    ...(typeof body?.companyCount === "number" ? { companyCount: body.companyCount } : {}),
    ...(body?.canViewAllCompanies ? { canViewAllCompanies: true } : {}),
  };
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
    const companyId = asString(permissions.companyId);
    const companyName = asString(permissions.companyName);
    // Tenant-exempt roles carry these instead of companyId — see
    // [[directory-scope]]. Read here so the edit screen can show the current
    // employer rather than an empty field.
    const employerCompanyId = asString(permissions.employerCompanyId);
    const employerCompanyName = asString(permissions.employerCompanyName);
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
      companyId,
      companyName,
      employerCompanyId,
      employerCompanyName,
    } satisfies AdminUserDirectoryEntry;
  });
}

export async function getAdminDirectoryUserById(
  userId: string,
): Promise<AdminUserDirectoryEntry | null> {
  // Goes through /api/profile, which decides whether this caller may see that
  // user: their own row always, anyone else's only with an admin role and only
  // inside their own company. A foreign id returns 404 and lands here as null.
  const sections = await getAllSections(userId);
  if (sections.length === 0) return null;

  const mapped = mapSectionItemsToUsers(
    sections.map((row) => ({
      userId,
      section: row.section,
      data: row.data as SectionData | undefined,
      updatedAt: row.updatedAt,
    })),
  );
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

  // Rule B: Drivers are never assigned a company — their access is scoped to
  // the loads assigned to them. Everyone else must have one, or the account
  // looks broken rather than unassigned.
  const isTenantExempt = TENANT_EXEMPT_ROLES.has(normalizeRole(payload.role));
  const companyId = isTenantExempt ? "" : (payload.companyId?.trim() ?? "");
  const companyName = isTenantExempt ? "" : (payload.companyName?.trim() ?? "");
  if (!isTenantExempt && (!companyId || !companyName)) {
    throw new Error("A company is required. Pick an existing one or add a new company.");
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
      // Placeholder only. The authoritative role and its Cognito group are set
      // by syncUserRole below, server-side.
      role: storageRole,
      permissionGroup: payload.permissionTemplate?.trim() || undefined,
      accessLevel: payload.accessLevel?.trim() || undefined,
      branch: payload.assignedBranch?.trim() || payload.officeBranch?.trim() || undefined,
      teams: payload.assignedTeam?.trim() || undefined,
      status: payload.accountStatus,
      dataAccessScope: payload.dataAccessScope?.trim() || undefined,
      modulePermissions: payload.modulePermissions,
      fieldPermissions: payload.fieldPermissions,
      // Tenant assignment — the one place a company is bound to a user.
      companyId,
      companyName,
    }),
  );

  await putSection(userId, "security", {
    accountStatus: payload.accountStatus,
    inviteStatus: payload.inviteStatus,
    twoFAStatus: payload.twoFAStatus,
    createdAt: now,
  });

  // Put the new user in their role's Cognito group. Deliberately after the
  // profile rows exist, because the endpoint reads the target's company from
  // them to run its cross-tenant check.
  try {
    await syncUserRole(userId, payload.role);
  } catch (err) {
    // The account exists and is usable; only the group is missing. Surfacing
    // this rather than swallowing it matters — an admin who thinks they created
    // a Dispatcher should not discover later that the token says otherwise.
    console.error("[admin] role group sync failed for the new user", err);
  }

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

type DirectoryResult = {
  users: AdminUserDirectoryEntry[];
  source: "server" | "dynamodb" | "cognito";
  warning?: string;
  /**
   * `"platform"` when the caller is a platform admin and is therefore seeing
   * every company, not just their own. The screen says so — otherwise a
   * legitimate cross-company view is indistinguishable from a broken filter.
   */
  scope?: "platform" | "company";
  /** Distinct companies represented, for the cross-company banner. */
  companyCount?: number;
  /** True when this caller may widen the view. Drives the UI toggle. */
  canViewAllCompanies?: boolean;
};

/**
 * The user directory, already scoped by the server.
 *
 * The scoping that used to live here — a `.filter()` over a full pool listing —
 * is gone. It kept every user *without* a companyId visible so that unassigned
 * users stayed assignable, which meant Drivers were visible to every company
 * forever: Rule B guarantees they never have one. See [[directory-scope]] for
 * the predicate that replaced it and why a Driver's employer is a separate
 * field.
 */
export async function listAdminDirectoryUsers(options?: {
  allCompanies?: boolean;
}): Promise<DirectoryResult> {
  return fetchDirectoryFromApi(options);
}

/**
 * Companies already in use, for the Add User picker.
 *
 * Derived from the directory rather than a Companies table — the lightweight
 * model. The trade-off is that a company with no users yet does not appear, and
 * a rename has to be applied per user (`renameCompany`).
 */
export async function listKnownCompanies(): Promise<KnownCompany[]> {
  const { users } = await fetchDirectoryFromApi();
  const byId = new Map<string, KnownCompany>();

  for (const user of users) {
    const companyId = user.companyId?.trim();
    if (!companyId) continue;
    const existing = byId.get(companyId);
    if (existing) {
      existing.userCount += 1;
      // Keep the first non-empty name we see; renames land via `renameCompany`.
      if (!existing.companyName && user.companyName) existing.companyName = user.companyName;
      continue;
    }
    byId.set(companyId, {
      companyId,
      companyName: user.companyName?.trim() ?? "",
      userCount: 1,
    });
  }

  return [...byId.values()].sort((a, b) =>
    a.companyName.localeCompare(b.companyName, undefined, { sensitivity: "base" }),
  );
}

export type CompanyAssignmentResult = {
  companyId: string | null;
  companyName: string | null;
  /** The target must re-authenticate before the change applies to them. */
  tokenRefreshRequired: boolean;
  /** False when `custom:sessionEpoch` is missing — old tokens stay valid. */
  revocationActive: boolean;
  /**
   * `"employer"` when the target is a tenant-exempt role: only the Profile
   * employer field was written, no claim and no epoch bump. Absent for an
   * ordinary tenant assignment.
   */
  scope?: "employer";
};

/**
 * Assign (or move) a user to a company.
 *
 * Goes through the server, which writes `custom:companyId` on the Cognito user
 * under the server's own IAM principal. The browser deliberately does not make
 * this call itself: doing so would require `cognito-idp:AdminUpdateUserAttributes`
 * on the Identity Pool role, which is the permission that lets any signed-in
 * user rewrite anyone's attributes.
 *
 * Pass an empty `companyId` to remove a user from their company.
 */
/**
 * Set a user's role, synced to their Cognito group.
 *
 * Goes through the server, which owns the group membership. The browser must
 * never hold `cognito-idp:AdminAddUserToGroup` — that action is what makes a
 * group trustworthy, and granting it to the Identity Pool role would let any
 * signed-in user put themselves in `superadmin`.
 *
 * The stored `permissions.role` is written by the server too, so the browser no
 * longer has a way to claim a role it was not given.
 */
export async function syncUserRole(
  userId: string,
  role: string,
): Promise<{ role: string; group: string; tokenRefreshRequired: boolean }> {
  if (!userId.trim()) throw new Error("userId is required.");

  const response = await fetch("/api/admin/user-role", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(await getServerAuthHeaders()),
    },
    body: JSON.stringify({ userId: userId.trim(), role }),
  });

  const body = (await response.json().catch(() => null)) as {
    role?: string;
    group?: string;
    tokenRefreshRequired?: boolean;
    error?: string;
  } | null;

  if (!response.ok) {
    throw new Error(body?.error ?? `Could not change the role (HTTP ${response.status}).`);
  }

  return {
    role: body?.role ?? role,
    group: body?.group ?? "",
    tokenRefreshRequired: body?.tokenRefreshRequired ?? true,
  };
}

export async function assignUserCompany(
  userId: string,
  company: { companyId: string; companyName: string },
): Promise<CompanyAssignmentResult> {
  const companyId = company.companyId.trim();
  const companyName = company.companyName.trim();
  if (!userId.trim()) throw new Error("userId is required.");
  if (companyId && !companyName) throw new Error("A company name is required.");

  const response = await fetch("/api/admin/company-assignment", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(await getServerAuthHeaders()),
    },
    body: JSON.stringify({ userId: userId.trim(), companyId, companyName }),
  });

  const body = (await response.json().catch(() => null)) as
    | (Partial<CompanyAssignmentResult> & { error?: string })
    | null;

  if (!response.ok) {
    throw new Error(body?.error ?? `Could not assign the company (HTTP ${response.status}).`);
  }

  return {
    companyId: body?.companyId ?? null,
    companyName: body?.companyName ?? null,
    tokenRefreshRequired: body?.tokenRefreshRequired ?? true,
    revocationActive: body?.revocationActive ?? false,
    ...(body?.scope === "employer" ? { scope: "employer" as const } : {}),
  };
}

/**
 * Rename a company across every user assigned to it.
 *
 * Only the display label changes, so this writes the Profile mirror directly —
 * `custom:companyId` on the Cognito user is unaffected and no token goes stale.
 *
 * The cost of the lightweight model: the name is denormalized onto each user,
 * so a rename is a fan-out rather than a single row update. Fine at this scale;
 * revisit if company count grows.
 */
export async function renameCompany(companyId: string, nextName: string): Promise<number> {
  const target = companyId.trim();
  const companyName = nextName.trim();
  if (!target || !companyName) throw new Error("A company id and new name are required.");

  const { users } = await fetchDirectoryFromApi();
  const members = users.filter((user) => user.companyId === target);
  for (const member of members) {
    await putSectionMerge(member.id, "permissions", { companyId: target, companyName });
  }
  return members.length;
}

/** Cached directory list — reuses session/memory until force refresh or sign-out. */
export async function listAdminDirectoryUsersCached(
  scope: string,
  options?: { force?: boolean; allCompanies?: boolean },
) {
  return fetchAdminDirectoryCached({
    // Distinct cache key per view. Sharing one would let the wider list be
    // served to the scoped view straight from sessionStorage — the leak the
    // server just refused, reintroduced by the cache.
    scope: options?.allCompanies ? `${scope}:all` : scope,
    force: options?.force,
    fetchRemote: () => listAdminDirectoryUsers({ allCompanies: options?.allCompanies }),
  });
}

export function cacheAdminDirectoryUser(scope: string, user: AdminUserDirectoryEntry) {
  prependAdminDirectoryCacheUser(scope, user);
}

export type AssignableRoleKind = "dispatcher" | "driver" | "broker";

function matchesAssignableRole(role: string | undefined, kind: AssignableRoleKind): boolean {
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
 * Directory fetch for the load-assignment pickers.
 *
 * This used to bypass the directory scoping entirely — a Cognito `ListUsers`
 * with a Profile-table `Scan` as fallback — so the Create Load driver dropdown
 * offered every driver in the pool regardless of company. It goes through the
 * same scoped endpoint as the admin list now.
 */
async function fetchDirectoryForAssignment(): Promise<AdminUserDirectoryEntry[]> {
  try {
    const { users } = await fetchDirectoryFromApi();
    if (users.length > 0) return users;
  } catch {
    /* fall through to the signed-in user below */
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
