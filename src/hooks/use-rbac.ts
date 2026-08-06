import * as React from "react";

import { useAuth } from "@/lib/auth";
import { useProfileSection } from "@/hooks/use-profile-section";
import {
  canAccessModule,
  canViewNavItem,
  canViewPath,
  firstAllowedPath,
  isPrivilegedRole,
  type ModuleName,
  type PermissionsRecord,
} from "@/lib/rbac";
import type { NavItem } from "@/lib/nav";
import { normalizeRole } from "@/lib/admin-user-constants";

const PERMISSIONS_DEFAULTS: PermissionsRecord = {};

/**
 * Current user's RBAC snapshot from Profile `permissions` (incl. modulePermissions).
 */
export function useRbac() {
  const { user, status } = useAuth();
  const section = useProfileSection<PermissionsRecord>("permissions", PERMISSIONS_DEFAULTS);

  const permissions = section.data;
  const loading = status === "loading" || section.loading;
  const privileged = isPrivilegedRole(permissions.role);
  const roleLabel = permissions.role ? normalizeRole(permissions.role) : null;

  const canView = React.useCallback(
    (moduleName: ModuleName) => canAccessModule(permissions, moduleName, "view"),
    [permissions],
  );

  const canMutate = React.useCallback(
    (moduleName: ModuleName) => canAccessModule(permissions, moduleName, "mutate"),
    [permissions],
  );

  const canViewItem = React.useCallback(
    (item: NavItem) => canViewNavItem(permissions, item),
    [permissions],
  );

  const canOpenPath = React.useCallback(
    (pathname: string) => canViewPath(permissions, pathname),
    [permissions],
  );

  const safeHome = React.useMemo(() => firstAllowedPath(permissions), [permissions]);

  return {
    permissions,
    loading,
    privileged,
    roleLabel,
    canView,
    canMutate,
    canViewItem,
    canOpenPath,
    safeHome,
    refresh: section.refresh,
    userId: user?.userId,
  };
}
