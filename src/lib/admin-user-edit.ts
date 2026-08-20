import {
  buildDefaultFieldPermissions,
  buildDefaultModulePermissions,
  normalizeInviteStatus,
  normalizeRole,
  normalizeStatus,
  normalizeTwoFaStatus,
  roleToStorageKey,
  type AccessScope,
  type FieldPermissionMatrix,
  type InviteStatus,
  type ModulePermissionMatrix,
  type PermissionLevel,
  type PermissionTemplate,
  type Role,
  type TwoFAStatus,
  type UserStatus,
} from "@/lib/admin-user-constants";
import {
  getAdminDirectoryUserById,
  syncUserRole,
  type AdminUserDirectoryEntry,
} from "@/lib/admin-users-store";
import { isDynamoConfigured } from "@/lib/dynamodb";
import { getSection, putSection } from "@/lib/profile-store";

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function splitName(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function parseModulePermissions(raw: unknown): ModulePermissionMatrix {
  const defaults = buildDefaultModulePermissions();
  if (!raw || typeof raw !== "object") return defaults;
  const source = raw as Record<string, Record<PermissionLevel, boolean>>;
  const next = { ...defaults };
  for (const moduleName of Object.keys(defaults) as (keyof ModulePermissionMatrix)[]) {
    if (source[moduleName]) {
      next[moduleName] = { ...defaults[moduleName], ...source[moduleName] };
    }
  }
  return next;
}

function parseFieldPermissions(raw: unknown): FieldPermissionMatrix {
  const defaults = buildDefaultFieldPermissions();
  if (!raw || typeof raw !== "object") return defaults;
  return { ...defaults, ...(raw as FieldPermissionMatrix) };
}

function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)) as T;
  }
  if (value && typeof value === "object") {
    const next: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (nested !== undefined) next[key] = stripUndefinedDeep(nested);
    }
    return next as T;
  }
  return value;
}

export type AdminUserEditDraft = {
  userId: string;
  firstName: string;
  lastName: string;
  displayName: string;
  email: string;
  phone: string;
  jobTitle: string;
  department: string;
  officeBranch: string;
  timeZone: string;
  language: string;
  role: Role;
  permissionTemplate: PermissionTemplate;
  accessLevel: "Standard" | "Elevated" | "Restricted";
  manager: string;
  assignedTeam: string;
  assignedBranch: string;
  dataAccessScope: AccessScope;
  accountStatus: UserStatus;
  inviteStatus: InviteStatus;
  twoFAStatus: TwoFAStatus;
  modulePermissions: ModulePermissionMatrix;
  fieldPermissions: FieldPermissionMatrix;
};

export function buildEmptyAdminUserEditDraft(userId: string): AdminUserEditDraft {
  return {
    userId,
    firstName: "",
    lastName: "",
    displayName: "",
    email: "",
    phone: "",
    jobTitle: "",
    department: "Operations",
    officeBranch: "",
    timeZone: "America/Chicago",
    language: "English",
    role: "Dispatcher",
    permissionTemplate: "Dispatcher Template",
    accessLevel: "Standard",
    manager: "",
    assignedTeam: "",
    assignedBranch: "",
    dataAccessScope: "Assigned Team Only",
    accountStatus: "Active",
    inviteStatus: "Accepted",
    twoFAStatus: "Optional",
    modulePermissions: buildDefaultModulePermissions(),
    fieldPermissions: buildDefaultFieldPermissions(),
  };
}

function entryToDraft(
  userId: string,
  entry: AdminUserDirectoryEntry | null,
  personal: Record<string, unknown>,
  permissions: Record<string, unknown>,
  security: Record<string, unknown>,
): AdminUserEditDraft {
  const fromName = entry?.name ? splitName(entry.name) : { firstName: "", lastName: "" };
  const firstName = asString(personal.given_name) || fromName.firstName;
  const lastName = asString(personal.family_name) || fromName.lastName;
  const accountStatus = normalizeStatus(
    asString(security.accountStatus) || asString(permissions.status) || entry?.status,
  );

  return {
    userId,
    firstName,
    lastName,
    displayName: asString(personal.nickname),
    email: asString(personal.email) || entry?.email || "",
    phone: asString(personal.phone_number) || entry?.phone || "",
    jobTitle: asString(personal.job_title),
    department: asString(personal.department) || entry?.department || "Operations",
    officeBranch: asString(personal.office_branch) || "",
    timeZone: asString(personal.zoneinfo) || "America/Chicago",
    language: asString(personal.locale) || "English",
    role: normalizeRole(asString(permissions.role) || entry?.role),
    permissionTemplate:
      (asString(permissions.permissionGroup) as PermissionTemplate) || "Dispatcher Template",
    accessLevel:
      (asString(permissions.accessLevel) as AdminUserEditDraft["accessLevel"]) || "Standard",
    manager: asString(permissions.manager),
    assignedTeam: asString(permissions.teams) || entry?.team || "",
    assignedBranch: asString(permissions.branch) || "",
    dataAccessScope: (asString(permissions.dataAccessScope) as AccessScope) || "Assigned Team Only",
    accountStatus,
    inviteStatus: normalizeInviteStatus(
      asString(security.inviteStatus) || entry?.inviteStatus,
      accountStatus,
    ),
    twoFAStatus: normalizeTwoFaStatus(asString(security.twoFAStatus) || entry?.twoFAStatus),
    modulePermissions: parseModulePermissions(permissions.modulePermissions),
    fieldPermissions: parseFieldPermissions(permissions.fieldPermissions),
  };
}

export async function loadAdminUserEditDraft(userId: string): Promise<AdminUserEditDraft | null> {
  if (!userId.trim()) return null;

  let entry: AdminUserDirectoryEntry | null = null;
  if (isDynamoConfigured()) {
    try {
      entry = await getAdminDirectoryUserById(userId);
    } catch {
      entry = null;
    }
  }

  if (!isDynamoConfigured()) {
    if (!entry) return null;
    return entryToDraft(userId, entry, {}, {}, {});
  }

  const [personalRes, permissionsRes, securityRes] = await Promise.all([
    getSection<Record<string, unknown>>(userId, "personal").catch(() => ({
      data: null,
      updatedAt: null,
    })),
    getSection<Record<string, unknown>>(userId, "permissions").catch(() => ({
      data: null,
      updatedAt: null,
    })),
    getSection<Record<string, unknown>>(userId, "security").catch(() => ({
      data: null,
      updatedAt: null,
    })),
  ]);

  const hasProfile =
    Boolean(entry) ||
    Boolean(personalRes.data) ||
    Boolean(permissionsRes.data) ||
    Boolean(securityRes.data);

  if (!hasProfile) return null;

  return entryToDraft(
    userId,
    entry,
    toRecord(personalRes.data),
    toRecord(permissionsRes.data),
    toRecord(securityRes.data),
  );
}

export async function saveAdminUserEditDraft(
  draft: AdminUserEditDraft,
): Promise<AdminUserDirectoryEntry> {
  if (!isDynamoConfigured()) {
    throw new Error("DynamoDB is not configured. Cannot save user profile.");
  }

  const userId = draft.userId.trim();
  const email = draft.email.trim().toLowerCase();
  const firstName = draft.firstName.trim();
  const lastName = draft.lastName.trim();

  if (!userId) throw new Error("User id is required.");
  if (!email) throw new Error("Email is required.");
  if (!firstName || !lastName) throw new Error("First and last name are required.");

  // Role is written by the server, which also syncs the Cognito group. Done
  // before the profile writes so a refused grant aborts the save rather than
  // leaving the form looking as if it applied.
  const current = await getAdminDirectoryUserById(userId);
  const roleChanged = normalizeRole(current?.role ?? "") !== draft.role;
  if (roleChanged) {
    await syncUserRole(userId, draft.role);
  }

  await putSection(userId, "personal", {
    given_name: firstName,
    family_name: lastName,
    nickname: draft.displayName.trim() || undefined,
    email,
    phone_number: draft.phone.trim() || undefined,
    job_title: draft.jobTitle.trim() || undefined,
    department: draft.department.trim() || undefined,
    zoneinfo: draft.timeZone.trim() || undefined,
    locale: draft.language.trim() || undefined,
    office_branch: draft.officeBranch.trim() || undefined,
  });

  await putSection(
    userId,
    "permissions",
    stripUndefinedDeep({
      // `role` is deliberately absent: the server owns it, alongside the
      // Cognito group. A browser-writable role would let a user claim one.
      permissionGroup: draft.permissionTemplate,
      accessLevel: draft.accessLevel,
      branch: draft.assignedBranch.trim() || draft.officeBranch.trim() || undefined,
      teams: draft.assignedTeam.trim() || undefined,
      manager: draft.manager.trim() || undefined,
      status: draft.accountStatus,
      dataAccessScope: draft.dataAccessScope,
      modulePermissions: draft.modulePermissions,
      fieldPermissions: draft.fieldPermissions,
    }),
  );

  await putSection(userId, "security", {
    accountStatus: draft.accountStatus,
    inviteStatus: draft.inviteStatus,
    twoFAStatus: draft.twoFAStatus,
  });

  const saved = await getAdminDirectoryUserById(userId);
  if (saved) return saved;

  return {
    id: userId,
    name: [firstName, lastName].filter(Boolean).join(" ") || email,
    email,
    phone: draft.phone.trim() || undefined,
    role: draft.role,
    department: draft.department.trim(),
    status: draft.accountStatus,
    team: draft.assignedTeam.trim(),
    inviteStatus: draft.inviteStatus,
    twoFAStatus: draft.twoFAStatus,
  };
}
