import { normalizeRole } from "@/lib/admin-user-constants";
import { isPrivilegedRole } from "@/lib/rbac";
import { useRbac } from "@/hooks/use-rbac";

import type { CommsAccessLevel } from "../types";

/**
 * Role matrix (§7.6) mapped onto this app's roles:
 * - Privileged (Owner/Admin/SuperAdmin) + Broker → full
 * - Dispatcher → shipper-like (own loads, read-only agent)
 * - Others with Communications access → client-like (inbox only)
 *
 * There is no first-class shipper/client role in Cognito; this mapping is the
 * closest equivalent for UX gating. Server routes must still enforce authz.
 */
export function resolveCommsAccessLevel(role?: string | null): CommsAccessLevel {
  if (!role?.trim()) return "client";
  if (isPrivilegedRole(role)) return "full";
  const normalized = normalizeRole(role);
  if (normalized === "Broker") return "full";
  if (normalized === "Dispatcher" || normalized === "Operations Manager") return "shipper";
  return "client";
}

export function useCommsAccess() {
  const { roleLabel, privileged, canView, canMutate, loading, userId } = useRbac();
  const level = resolveCommsAccessLevel(roleLabel);

  return {
    level,
    loading,
    userId,
    canOpenInbox: canView("Communications") || privileged,
    canEditAgent: level === "full",
    canViewAgent: level === "full" || level === "shipper",
    canEditRules: level === "full",
    canViewCompliance: level === "full",
    canMutateInbox: canMutate("Communications") || privileged || level === "full",
  };
}
