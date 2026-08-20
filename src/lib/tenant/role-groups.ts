/**
 * Roles as Cognito groups.
 *
 * ## Why groups at all
 *
 * A role lives in two places today: `permissions.role` in the Profile table,
 * and — for platform admins — `cognito:groups` in the token. Only the second is
 * trustworthy. The Profile row is writable by any browser holding Identity Pool
 * credentials, so a user can set their own `role` string to anything; group
 * membership can only change through `cognito-idp:AdminAddUserToGroup`, which
 * no browser holds.
 *
 * Syncing the two makes the token the authority for every role, not just the
 * privileged one, and lets the stored copy become what it should always have
 * been: a display value.
 *
 * ## Group naming
 *
 * Group names are the `ROLE_STORAGE_KEYS` values, not the display labels.
 * Cognito group names disallow spaces, and "Organization Owner" has one. The
 * keys are already the stable identifier the Profile row stores, so the two
 * agree by construction.
 *
 * ## The privileged set
 *
 * `superadmin` confers cross-company reach. Granting it is not an ordinary
 * administrative act and is gated separately — see `isPrivilegedRoleGroup`.
 * Nothing here decides who may grant what; that is the endpoint's job. This
 * module only names things.
 */
import { ROLE_STORAGE_KEYS, type Role } from "@/lib/admin-user-constants";
import { strictRole } from "@/lib/tenant/strict-role";
import { PLATFORM_ADMIN_GROUPS } from "@/lib/tenant/tenant-exemption";

/** The Cognito group backing a role. */
export function roleGroupName(role: Role): string {
  return ROLE_STORAGE_KEYS[role];
}

/** The canonical group names this system creates. */
export const MANAGED_ROLE_GROUPS: ReadonlySet<string> = new Set(
  Object.values(ROLE_STORAGE_KEYS),
);

/**
 * Is this an existing group that role sync owns, whatever it is called?
 *
 * Matching on the canonical names alone was a bug with real consequences. A
 * pool provisioned by hand before sync existed carries `SuperAdmin`, not
 * `superadmin`, so an exact-string check skipped it: demoting that user added
 * `admin` and left `SuperAdmin` attached. Because `PLATFORM_ADMIN_GROUPS`
 * honours `SuperAdmin`, the demotion silently failed to revoke cross-tenant
 * access — the user kept every company's data.
 *
 * So membership is decided by what a group name *resolves to*, not by how it is
 * spelled. `strictRole` accepts both the display label and the storage key, and
 * the privileged aliases are covered explicitly.
 */
export function isManagedRoleGroup(group: string): boolean {
  const name = group.trim();
  if (!name) return false;
  if (MANAGED_ROLE_GROUPS.has(name)) return true;
  if (isPrivilegedRoleGroup(name)) return true;
  return strictRole(name) !== null;
}

/**
 * True when two group names mean the same role.
 *
 * `SuperAdmin` and `superadmin` are the same grant spelled differently; without
 * this, sync would leave one attached while adding the other.
 */
export function sameRoleGroup(a: string, b: string): boolean {
  if (a.trim() === b.trim()) return true;
  const left = strictRole(a);
  return left !== null && left === strictRole(b);
}

/**
 * True when membership of this group confers platform-operator privilege.
 *
 * Checks both the literal name and the display form, because
 * `PLATFORM_ADMIN_GROUPS` predates this module and existing pools may already
 * carry a group called `SuperAdmin` rather than `superadmin`. Treating either
 * as privileged is the safe direction: the failure mode of being too broad here
 * is refusing a grant, and the failure mode of being too narrow is handing out
 * cross-tenant access as if it were an ordinary role.
 */
export function isPrivilegedRoleGroup(group: string): boolean {
  const name = group.trim();
  if (PLATFORM_ADMIN_GROUPS.has(name)) return true;
  return name.toLowerCase() === "superadmin" || name.toLowerCase() === "platform-admin";
}

/** True when assigning this role would confer platform-operator privilege. */
export function isPrivilegedRole(role: Role): boolean {
  return isPrivilegedRoleGroup(roleGroupName(role));
}
