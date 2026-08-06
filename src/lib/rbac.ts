import {
  MODULES,
  PERMISSION_LEVELS,
  normalizeRole,
  type ModuleName,
  type ModulePermissionMatrix,
  type PermissionLevel,
  type Role,
} from "@/lib/admin-user-constants";
import type { NavItem } from "@/lib/nav";

/** Levels that grant at least read access to a module. */
const VIEW_LEVELS: ReadonlySet<PermissionLevel> = new Set([
  "View Only",
  "Create",
  "Edit",
  "Delete",
  "Approve",
  "Export",
  "Full Access",
]);

const MUTATE_LEVELS: ReadonlySet<PermissionLevel> = new Set([
  "Create",
  "Edit",
  "Delete",
  "Approve",
  "Export",
  "Full Access",
]);

export type PermissionsRecord = {
  role?: string;
  permissionGroup?: string;
  accessLevel?: string;
  dataAccessScope?: string;
  adminAccess?: boolean;
  modulePermissions?: ModulePermissionMatrix | Record<string, Record<string, boolean>>;
  fieldPermissions?: Record<string, boolean>;
  [key: string]: unknown;
};

/** Map app pathnames → MODULES entries used in admin RBAC matrices. */
export const ROUTE_MODULE_RULES: { prefix: string; module: ModuleName }[] = [
  { prefix: "/dashboard", module: "Dashboard" },
  { prefix: "/loads", module: "Loads" },
  { prefix: "/truckboard", module: "TruckBoard" },
  { prefix: "/tracking", module: "Tracking" },
  { prefix: "/bidding", module: "Bidding" },
  { prefix: "/rfps", module: "RFPs" },
  { prefix: "/quotes", module: "Quotes" },
  { prefix: "/carriers", module: "Carriers / Brokers" },
  { prefix: "/crm", module: "CRM & Sales" },
  { prefix: "/risk", module: "Risk Models" },
  { prefix: "/analytics", module: "Analytics" },
  { prefix: "/accounting", module: "Accounting" },
  { prefix: "/communications", module: "Communications" },
  { prefix: "/settings", module: "Settings" },
  { prefix: "/admin", module: "Admin" },
  { prefix: "/profile", module: "Profile" },
];

/** Nav title → module (titles already match MODULES). */
export function navItemToModule(item: NavItem): ModuleName | null {
  if ((MODULES as readonly string[]).includes(item.title)) {
    return item.title as ModuleName;
  }
  return null;
}

export function moduleForPathname(pathname: string): ModuleName | null {
  if (pathname === "/" || pathname === "") return "Dashboard";
  const sorted = [...ROUTE_MODULE_RULES].sort((a, b) => b.prefix.length - a.prefix.length);
  for (const rule of sorted) {
    if (pathname === rule.prefix || pathname.startsWith(`${rule.prefix}/`)) {
      return rule.module;
    }
  }
  return null;
}

export function isPrivilegedRole(role?: string | null): boolean {
  if (!role?.trim()) return false;
  const normalized = normalizeRole(role);
  return (
    normalized === "Organization Owner" ||
    normalized === "Admin" ||
    normalized === "SuperAdmin"
  );
}

function asMatrix(
  raw: PermissionsRecord["modulePermissions"],
): ModulePermissionMatrix | null {
  if (!raw || typeof raw !== "object") return null;
  const keys = Object.keys(raw);
  if (keys.length === 0) return null;
  return raw as ModulePermissionMatrix;
}

function levelEnabled(
  matrix: ModulePermissionMatrix,
  moduleName: ModuleName,
  level: PermissionLevel,
): boolean {
  const row = matrix[moduleName];
  if (!row || typeof row !== "object") return false;
  return Boolean(row[level]);
}

function anyLevel(
  matrix: ModulePermissionMatrix,
  moduleName: ModuleName,
  levels: ReadonlySet<PermissionLevel>,
): boolean {
  for (const level of PERMISSION_LEVELS) {
    if (!levels.has(level)) continue;
    if (levelEnabled(matrix, moduleName, level)) return true;
  }
  return false;
}

/**
 * Resolve effective access for a module.
 * - Privileged roles (Owner / Admin / SuperAdmin): full access
 * - Missing / empty matrix: permissive (setup DX — don't lock new orgs out)
 * - Present matrix: enforce No Access vs view/mutate flags
 */
export function canAccessModule(
  permissions: PermissionsRecord | null | undefined,
  moduleName: ModuleName,
  action: "view" | "mutate" = "view",
): boolean {
  if (isPrivilegedRole(permissions?.role)) return true;
  if (permissions?.adminAccess === true && moduleName === "Admin") return true;

  const matrix = asMatrix(permissions?.modulePermissions);
  if (!matrix) return true;

  // Explicit No Access with no other grants → deny
  const noAccess = levelEnabled(matrix, moduleName, "No Access");
  const hasView = anyLevel(matrix, moduleName, VIEW_LEVELS);
  const hasMutate = anyLevel(matrix, moduleName, MUTATE_LEVELS);

  if (action === "view") {
    if (hasView || hasMutate) return true;
    if (noAccess) return false;
    // Module row missing entirely → allow (partial matrices from older templates)
    return !matrix[moduleName];
  }

  // mutate
  if (hasMutate) return true;
  if (noAccess || hasView) return false;
  return !matrix[moduleName];
}

export function canViewNavItem(
  permissions: PermissionsRecord | null | undefined,
  item: NavItem,
): boolean {
  const moduleName = navItemToModule(item);
  if (!moduleName) return true;
  // Profile is always reachable for the signed-in user.
  if (moduleName === "Profile") return true;
  return canAccessModule(permissions, moduleName, "view");
}

export function canViewPath(
  permissions: PermissionsRecord | null | undefined,
  pathname: string,
): boolean {
  const moduleName = moduleForPathname(pathname);
  if (!moduleName) return true;
  if (moduleName === "Profile") return true;
  return canAccessModule(permissions, moduleName, "view");
}

export function firstAllowedPath(
  permissions: PermissionsRecord | null | undefined,
  candidates: string[] = ["/dashboard", "/loads", "/profile"],
): string {
  for (const path of candidates) {
    if (canViewPath(permissions, path)) return path;
  }
  return "/profile";
}

export function describeModuleAccess(
  permissions: PermissionsRecord | null | undefined,
  moduleName: ModuleName,
): string {
  if (isPrivilegedRole(permissions?.role)) return "Full Access (privileged role)";
  const matrix = asMatrix(permissions?.modulePermissions);
  if (!matrix) return "Full Access (no matrix configured)";
  if (!canAccessModule(permissions, moduleName, "view")) return "No Access";
  if (canAccessModule(permissions, moduleName, "mutate")) return "Edit+";
  return "View Only";
}

export type { ModuleName, PermissionLevel, Role };
