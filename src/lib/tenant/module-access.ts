/**
 * Server-side enforcement of the admin console's per-user module matrix.
 *
 * ## The gap this closes
 *
 * `ModuleAccessGate` and `useRbac` read `permissions.modulePermissions` in the
 * browser and hide what the user may not open. That is the right behaviour for a
 * navigation menu and it is not access control: the matrix is evaluated on the
 * client, so unchecking a box removed a sidebar entry and left the API that
 * backs the page answering exactly as before. Anyone who kept the URL, or called
 * `/api/...` directly, was unaffected by the admin's decision.
 *
 * So the decision is re-made here, on the server, from the stored matrix — using
 * `canAccessModule`, the *same* evaluator the browser uses. Two implementations
 * of "does this matrix grant Inventory" would eventually disagree, and the
 * disagreement would be the hole.
 *
 * ## Role comes from the token, not from the matrix
 *
 * `canAccessModule` short-circuits for privileged roles, and it reads that role
 * off the permissions record with `normalizeRole` — which is fuzzy by design
 * (anything containing "admin" becomes Admin). Fine for rendering a label;
 * not fine for a boundary. So the stored role is replaced with the strict role
 * from the verified token before evaluation. A caller whose role does not
 * resolve strictly is simply not privileged, and the matrix decides.
 *
 * The net effect is that this gate is never more permissive than the browser's,
 * and usually slightly less.
 *
 * ## Layering
 *
 * This answers "may this user reach this module at all". It does not answer
 * "may this role perform this operation" — that stays with the per-resource role
 * gates (`load-permissions`, `inventory-permissions`), which are keyed on the
 * token's role and cannot be widened by editing a profile. Both run. An admin
 * granting Inventory → Full Access to a Marketing account gets them the page and
 * still not the ability to write off a pallet.
 *
 * ## Cost
 *
 * None in the common case. The matrix rides along with the role lookup that
 * `requireCurrentTenantContext` already performs, and shares its 60-second
 * cache — so this is a map lookup on any request that has already built a tenant
 * context.
 */
import { resolveRequestRole } from "@/lib/ai/ai-authz";
import type { FieldPermission } from "@/lib/admin-user-constants";
import {
  canAccessModule,
  isPrivilegedRole,
  type ModuleName,
  type PermissionsRecord,
} from "@/lib/rbac";
import { logTenantDenial, type TenantContext } from "@/lib/tenant/server-tenant-context";

export type ModuleAccessDenial = {
  ok: false;
  status: 403;
  code: "module_forbidden" | "module_check_failed";
  message: string;
};

export type ModuleAccessCheck = { ok: true } | ModuleAccessDenial;

/**
 * May this caller reach this module?
 *
 * @param action `"view"` for reads, `"mutate"` for writes — the same two levels
 *   the admin matrix distinguishes.
 */
export async function checkModuleAccess(
  request: Request,
  ctx: TenantContext,
  moduleName: ModuleName,
  action: "view" | "mutate",
): Promise<ModuleAccessCheck> {
  // A platform operator crosses companies by design; the per-company module
  // matrix is not theirs and does not apply. Every such crossing is audited
  // where it happens.
  if (ctx.isPlatformAdmin) return { ok: true };

  const resolved = await resolveRequestRole(request);
  if (!resolved.ok) {
    // Fail closed. Not being able to establish what a caller is permitted is the
    // same class of problem as their not being permitted.
    logTenantDenial(ctx, `module permission lookup failed for ${moduleName}`);
    return {
      ok: false,
      status: 403,
      code: "module_check_failed",
      message: "Could not verify your permissions. Try again shortly.",
    };
  }

  const stored = (resolved.permissions ?? {}) as PermissionsRecord;
  // Strict token role wins over the stored one — see the header.
  const permissions: PermissionsRecord = { ...stored, role: ctx.role ?? undefined };

  if (canAccessModule(permissions, moduleName, action)) return { ok: true };

  logTenantDenial(ctx, `module permissions deny ${action} on ${moduleName}`);
  return {
    ok: false,
    status: 403,
    code: "module_forbidden",
    message:
      action === "view"
        ? `Your access does not include ${moduleName}. Ask an admin to update Role & Access.`
        : `Your access to ${moduleName} is read-only. Ask an admin to update Role & Access.`,
  };
}

/** Shape a denial as the JSON body every proxy in this codebase returns. */
export function moduleAccessResponse(denial: ModuleAccessDenial): Response {
  return Response.json({ error: denial.message, code: denial.code }, { status: denial.status });
}

/**
 * Is this field-level permission granted to the caller?
 *
 * The admin console's `fieldPermissions` toggles, read on the server so they can
 * do something a hidden table column cannot: keep a value out of the response
 * body. A column the browser declines to render is still in the JSON, which
 * makes it a presentation choice rather than a permission.
 *
 * Shares the cached profile read with `checkModuleAccess`, so this is free on a
 * request that already built a tenant context.
 *
 * Fails **closed** on a lookup error but **open** on an absent matrix, matching
 * `canAccessModule`: an org that has never opened the permissions editor should
 * not silently lose data from its reports.
 */
export async function hasFieldPermission(
  request: Request,
  ctx: TenantContext,
  permission: FieldPermission,
): Promise<boolean> {
  if (ctx.isPlatformAdmin) return true;
  // Privileged by the *token's* role, not the stored one — see the header.
  if (isPrivilegedRole(ctx.role)) return true;

  const resolved = await resolveRequestRole(request);
  if (!resolved.ok) return false;

  const stored = (resolved.permissions ?? {}) as PermissionsRecord;
  const matrix = stored.fieldPermissions;
  if (!matrix || typeof matrix !== "object" || Object.keys(matrix).length === 0) return true;
  return Boolean(matrix[permission]);
}
