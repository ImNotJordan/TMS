/**
 * What the signed-in user may do in the inventory module, as far as the browser
 * can tell.
 *
 * ## This is not the boundary
 *
 * Every decision here is re-made on the server from a verified token — the
 * module matrix in `module-access`, the role gates in `inventory-permissions`.
 * This hook exists so a control the server would refuse is disabled with a
 * reason attached, instead of looking available and failing as a toast. Getting
 * it *wrong* costs a confusing 403; getting the server wrong costs data.
 *
 * ## Why an unknown role is treated permissively
 *
 * The server resolves the role from `cognito:groups` first, and the browser's
 * auth context does not expose group membership. So when neither
 * `custom:role` nor the stored profile role resolves strictly, the honest answer
 * is "the browser cannot tell" — and the useful behaviour is to let the user try
 * and surface the server's answer, rather than to grey out a button a
 * group-assigned Operations Manager is fully entitled to press.
 *
 * The module matrix, which the browser *does* hold in full, still applies in
 * that case. So an unknown role widens the role gate, never the module gate.
 */
import * as React from "react";

import { useAuth } from "@/lib/auth";
import { useRbac } from "@/hooks/use-rbac";
import { strictRole } from "@/lib/tenant/strict-role";
import type { InventoryMovementKind, StockLevels } from "@/lib/inventory-domain";
import {
  roleCanDeleteInventory,
  roleCanMoveStock,
  roleCanValueInventory,
  roleCanWriteInventory,
} from "@/lib/tenant/inventory-permissions";
import type { Role } from "@/lib/admin-user-constants";

export type InventoryAccess = {
  loading: boolean;
  /** Strict role, or null when the browser cannot establish one. */
  role: Role | null;
  roleLabel: string | null;
  privileged: boolean;
  canViewModule: boolean;
  canMutateModule: boolean;
  canCreateItems: boolean;
  canEditItems: boolean;
  canDeleteItems: boolean;
  canValueInventory: boolean;
  canPostMovement: (kind: InventoryMovementKind) => boolean;
  /** Null when permitted; otherwise the sentence to show in a tooltip. */
  denyReason: (action: "create" | "edit" | "delete" | "value" | "move" | "adjust") => string | null;
};

const MODULE_READ_ONLY =
  "Your access to Inventory is read-only. Ask an admin to update Role & Access → Module Permissions.";

export function useInventoryAccess(): InventoryAccess {
  const { user } = useAuth();
  const { permissions, loading, privileged, canView, canMutate } = useRbac();

  const role = React.useMemo(() => {
    // `custom:role` first: it is the claim the token carries, so it is the
    // closest available proxy for what the server will decide.
    return (
      strictRole(user?.attributes?.["custom:role"]) ??
      strictRole(permissions.role as string | undefined)
    );
  }, [permissions.role, user?.attributes]);

  const canViewModule = canView("Inventory");
  const canMutateModule = canMutate("Inventory");

  // `role === null` → the browser cannot tell; defer to the server. See header.
  const roleWrites = role === null || roleCanWriteInventory(role);
  const roleDeletes = role === null || roleCanDeleteInventory(role);
  const roleValues = role === null || roleCanValueInventory(role);

  const fieldGrantsValuation = React.useMemo(() => {
    const matrix = permissions.fieldPermissions;
    if (!matrix || typeof matrix !== "object" || Object.keys(matrix).length === 0) return true;
    return Boolean(matrix["Can View Inventory Valuation"]);
  }, [permissions.fieldPermissions]);

  const canPostMovement = React.useCallback(
    (kind: InventoryMovementKind) =>
      canMutateModule && (role === null || roleCanMoveStock(role, kind)),
    [canMutateModule, role],
  );

  const canCreateItems = canMutateModule && roleWrites;
  const canEditItems = canMutateModule && roleWrites;
  const canDeleteItems = canMutateModule && roleDeletes;
  // Mirrors the server: entitled by role, or by the explicit field-permission
  // toggle. Either alone is enough — the two are alternatives, not both required.
  const canValueInventory = privileged || roleValues || fieldGrantsValuation;

  const denyReason = React.useCallback(
    (action: "create" | "edit" | "delete" | "value" | "move" | "adjust"): string | null => {
      if (loading) return null;
      if (!canMutateModule && action !== "value") return MODULE_READ_ONLY;
      if (role === null) return null;

      switch (action) {
        case "create":
        case "edit":
          return roleCanWriteInventory(role)
            ? null
            : `${role} cannot ${action === "create" ? "create" : "edit"} inventory items.`;
        case "delete":
          return roleCanDeleteInventory(role) ? null : `${role} cannot delete inventory items.`;
        case "move":
          return roleCanMoveStock(role) ? null : `${role} cannot post inventory movements.`;
        case "adjust":
          return roleCanMoveStock(role, "adjustment")
            ? null
            : `${role} cannot post adjustments or cycle counts. Ask an Operations Manager.`;
        case "value":
          return roleCanValueInventory(role) || fieldGrantsValuation
            ? null
            : "Your access does not include inventory valuation.";
        default:
          return null;
      }
    },
    [canMutateModule, fieldGrantsValuation, loading, role],
  );

  return {
    loading,
    role,
    roleLabel: role,
    privileged,
    canViewModule,
    canMutateModule,
    canCreateItems,
    canEditItems,
    canDeleteItems,
    canValueInventory,
    canPostMovement,
    denyReason,
  };
}

/** Re-exported for the movement dialog's live preview. */
export type { StockLevels };
