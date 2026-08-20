export const USER_STATUSES = [
  "Active",
  "Pending Invite",
  "Inactive",
  "Suspended",
  "Locked",
  "Deactivated",
] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const INVITE_STATUSES = [
  "Not Sent",
  "Sent",
  "Opened",
  "Accepted",
  "Expired",
  "Canceled",
] as const;
export type InviteStatus = (typeof INVITE_STATUSES)[number];

export const TWO_FA_STATUSES = ["Required", "Enabled", "Optional", "Disabled"] as const;
export type TwoFAStatus = (typeof TWO_FA_STATUSES)[number];

export const ROLES = [
  "Organization Owner",
  "Admin",
  "SuperAdmin",
  "Operations Manager",
  "Broker",
  "Dispatcher",
  "Driver",
  "Accounting",
  "Sales",
  "Marketing",
] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSION_TEMPLATES = [
  "Dispatcher Template",
  "Accounting Template",
  "Sales Template",
  "Broker Template",
  "Carrier Manager Template",
  "Admin Template",
  "Driver Template",
  "Customer Portal Template",
] as const;
export type PermissionTemplate = (typeof PERMISSION_TEMPLATES)[number];

export const ACCESS_SCOPES = [
  "All Company Data",
  "Assigned Branch Only",
  "Assigned Team Only",
  "Assigned Customers Only",
  "Assigned Carriers Only",
  "Assigned Loads Only",
  "Own Records Only",
] as const;
export type AccessScope = (typeof ACCESS_SCOPES)[number];

export const MODULES = [
  "Dashboard",
  "Bidding",
  "Risk Models",
  "RFPs",
  "Quotes",
  "Loads",
  "TruckBoard",
  "Analytics",
  "Carriers / Brokers",
  "Tracking",
  "Communications",
  "Accounting",
  "CRM & Sales",
  "Settings",
  "Admin",
  "Profile",
] as const;
export type ModuleName = (typeof MODULES)[number];

export const PERMISSION_LEVELS = [
  "No Access",
  "View Only",
  "Create",
  "Edit",
  "Delete",
  "Approve",
  "Export",
  "Full Access",
] as const;
export type PermissionLevel = (typeof PERMISSION_LEVELS)[number];

export const FIELD_PERMISSIONS = [
  "Can View Customer Rates",
  "Can View Carrier Rates",
  "Can View Gross Margin",
  "Can Edit Load Pricing",
  "Can Approve Carrier Payments",
  "Can View Accounting Reports",
  "Can Export Customer Data",
  "Can Edit Carrier Compliance",
  "Can Access Risk Models",
  "Can Manage Integrations",
] as const;
export type FieldPermission = (typeof FIELD_PERMISSIONS)[number];

export type ModulePermissionMatrix = Record<ModuleName, Record<PermissionLevel, boolean>>;
export type FieldPermissionMatrix = Record<FieldPermission, boolean>;

export function buildDefaultModulePermissions(): ModulePermissionMatrix {
  const matrix = {} as ModulePermissionMatrix;
  for (const moduleName of MODULES) {
    matrix[moduleName] = {
      "No Access": true,
      "View Only": false,
      Create: false,
      Edit: false,
      Delete: false,
      Approve: false,
      Export: false,
      "Full Access": false,
    };
  }
  matrix.Dashboard["View Only"] = true;
  matrix.Dashboard["No Access"] = false;
  matrix.Loads["View Only"] = true;
  matrix.Loads.Create = true;
  matrix.Loads.Edit = true;
  matrix.Loads["No Access"] = false;
  return matrix;
}

export function buildDefaultFieldPermissions(): FieldPermissionMatrix {
  const matrix = {} as FieldPermissionMatrix;
  for (const permission of FIELD_PERMISSIONS) {
    matrix[permission] = false;
  }
  matrix["Can View Customer Rates"] = true;
  matrix["Can View Carrier Rates"] = true;
  return matrix;
}

/** Canonical storage keys written to Profile `permissions.role`. */
export const ROLE_STORAGE_KEYS = {
  "Organization Owner": "organization_owner",
  Admin: "admin",
  SuperAdmin: "superadmin",
  "Operations Manager": "ops",
  Broker: "broker",
  Dispatcher: "dispatch",
  Driver: "driver",
  Accounting: "accounting",
  Sales: "sales",
  Marketing: "marketing",
} as const satisfies Record<Role, string>;

export type RoleStorageKey = (typeof ROLE_STORAGE_KEYS)[Role];

/** Persist a UI role as a stable Dynamo/Cognito permissions key. */
export function roleToStorageKey(role: string): string {
  const trimmed = role.trim();
  if (!trimmed) return ROLE_STORAGE_KEYS["Operations Manager"];

  const exact = ROLES.find((r) => r.toLowerCase() === trimmed.toLowerCase());
  if (exact) return ROLE_STORAGE_KEYS[exact];

  const normalized = trimmed.toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized.includes("organization_owner") || normalized.includes("owner")) {
    return ROLE_STORAGE_KEYS["Organization Owner"];
  }
  if (
    normalized.includes("superadmin") ||
    (normalized.includes("super") && normalized.includes("admin"))
  ) {
    return ROLE_STORAGE_KEYS.SuperAdmin;
  }
  if (normalized === "admin" || normalized.endsWith("_admin")) return ROLE_STORAGE_KEYS.Admin;
  if (normalized.includes("dispatch")) return ROLE_STORAGE_KEYS.Dispatcher;
  if (normalized.includes("driver")) return ROLE_STORAGE_KEYS.Driver;
  if (normalized.includes("account")) return ROLE_STORAGE_KEYS.Accounting;
  if (normalized.includes("sales")) return ROLE_STORAGE_KEYS.Sales;
  if (normalized.includes("market")) return ROLE_STORAGE_KEYS.Marketing;
  if (normalized.includes("broker")) return ROLE_STORAGE_KEYS.Broker;
  if (normalized.includes("operation") || normalized === "ops" || normalized.includes("ops")) {
    return ROLE_STORAGE_KEYS["Operations Manager"];
  }
  if (normalized.includes("admin")) return ROLE_STORAGE_KEYS.Admin;
  return normalized;
}

export function normalizeRole(value: string | undefined): Role {
  if (!value?.trim()) return "Operations Manager";

  const exact = ROLES.find((role) => role.toLowerCase() === value.trim().toLowerCase());
  if (exact) return exact;

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  // Prefer storage-key matches first (round-trip safe).
  if (
    normalized === "organization_owner" ||
    normalized === "org_owner" ||
    normalized.includes("organization_owner")
  ) {
    return "Organization Owner";
  }
  if (
    normalized === "superadmin" ||
    (normalized.includes("super") && normalized.includes("admin"))
  ) {
    return "SuperAdmin";
  }
  if (normalized === "admin") return "Admin";
  if (
    normalized === "ops" ||
    normalized === "operations_manager" ||
    normalized.includes("operation")
  ) {
    return "Operations Manager";
  }
  if (normalized === "dispatch" || normalized === "dispatcher" || normalized.includes("dispatch")) {
    return "Dispatcher";
  }
  if (normalized === "driver" || normalized.includes("driver")) return "Driver";
  if (normalized === "accounting" || normalized.includes("account")) return "Accounting";
  if (normalized === "sales" || normalized.includes("sales")) return "Sales";
  if (normalized === "marketing" || normalized.includes("market")) return "Marketing";
  if (normalized === "broker" || normalized.includes("broker")) return "Broker";

  // Fuzzy leftovers (avoid mapping Driver → Ops — that was a production bug).
  if (normalized.includes("owner")) return "Organization Owner";
  if (normalized.includes("admin")) return "Admin";
  if (normalized.includes("ops")) return "Operations Manager";

  return "Operations Manager";
}

/** Display label for a stored or free-form role string. */
export function formatStoredRole(role: string | undefined): string | undefined {
  if (!role?.trim()) return undefined;
  return normalizeRole(role);
}

export function normalizeStatus(value: string | undefined): UserStatus {
  if (!value) return "Active";
  const exact = USER_STATUSES.find((status) => status.toLowerCase() === value.toLowerCase());
  if (exact) return exact;
  const normalized = value.toLowerCase();
  if (normalized.includes("pending")) return "Pending Invite";
  if (normalized.includes("suspend")) return "Suspended";
  if (normalized.includes("lock")) return "Locked";
  if (normalized.includes("deactiv")) return "Deactivated";
  if (normalized.includes("inactive")) return "Inactive";
  return "Active";
}

export function normalizeInviteStatus(value: string | undefined, status: UserStatus): InviteStatus {
  const exact =
    value &&
    INVITE_STATUSES.find((inviteStatus) => inviteStatus.toLowerCase() === value.toLowerCase());
  if (exact) return exact;
  if (status === "Pending Invite") return "Sent";
  if (status === "Inactive") return "Expired";
  return "Accepted";
}

export function normalizeTwoFaStatus(value: string | undefined): TwoFAStatus {
  if (!value) return "Optional";
  const exact = TWO_FA_STATUSES.find((status) => status.toLowerCase() === value.toLowerCase());
  if (exact) return exact;
  const normalized = value.toLowerCase();
  if (normalized.includes("require")) return "Required";
  if (normalized.includes("enable")) return "Enabled";
  if (normalized.includes("disable")) return "Disabled";
  return "Optional";
}
