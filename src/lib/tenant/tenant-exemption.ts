/**
 * Who is exempt from carrying a `companyId` — the rules, with no dependencies.
 *
 * These live apart from `server-tenant-context.ts` so the browser can read them
 * too. That module imports the JWT verifier (JWKS, crypto); pulling it into the
 * client bundle to learn one Set of strings is the wrong trade.
 *
 * The alternative — a second copy of the rules in the client — is worse than
 * either. The onboarding gate decides who gets shown the app, and the server
 * decides who gets data. If those two disagree, the gate either locks out a
 * legitimate driver or waves through a user the API will refuse on every
 * request. One definition, imported twice, cannot drift.
 *
 * Nothing here is a security boundary on its own. The client uses it to choose a
 * screen; the server uses it to make decisions. Only the second one counts.
 */

/**
 * Roles that must never carry a `companyId`.
 *
 * Drivers work across companies over a career and are scoped by assignment
 * (`assignedDriver = them`), not by tenancy. Giving one a company would be
 * meaningless at best — and at worst would hand them a whole company's records
 * through the ordinary tenant filter.
 */
export const TENANT_EXEMPT_ROLES: ReadonlySet<string> = new Set(["Driver"]);

/**
 * Cognito groups that confer platform-operator privilege — the ability to act
 * across companies rather than within one.
 *
 * **Group membership only, never a stored role.** The Profile table's
 * `permissions.role` is writable by any browser holding Identity Pool
 * credentials, so keying platform privilege on it would let a user promote
 * themselves and then assign themselves into any company — undoing the entire
 * tenant boundary with a single PutItem. Cognito group membership can only be
 * changed with `cognito-idp:AdminAddUserToGroup`, which no browser holds.
 *
 * Create the group in the Cognito console and add operators to it explicitly.
 */
export const PLATFORM_ADMIN_GROUPS: ReadonlySet<string> = new Set([
  "SuperAdmin",
  // The storage-key form, which is what role/group sync creates. Both are
  // listed because pools provisioned before that sync may carry either. Being
  // too broad here refuses nothing and grants nothing extra; being too narrow
  // would silently fail to recognise a platform admin — see role-groups.ts.
  "superadmin",
  "platform-admin",
]);

/** Claim carrying Cognito group membership. */
export const GROUPS_CLAIM = "cognito:groups";

/**
 * True when the role is one that must not have a company.
 *
 * Takes the already-resolved role. Callers must resolve it strictly — see
 * `strictRole` — because a fuzzy resolver that answers "Driver" for an
 * unexpected string would exempt the wrong account.
 */
export function isRoleTenantExempt(role: string | null | undefined): boolean {
  return Boolean(role && TENANT_EXEMPT_ROLES.has(role));
}

/**
 * True when the claims carry platform-operator group membership.
 *
 * Read straight from `cognito:groups`, never from a stored role, for the reason
 * given above.
 */
export function hasPlatformAdminGroup(claims: Record<string, unknown> | null | undefined): boolean {
  const groups = claims?.[GROUPS_CLAIM];
  if (!Array.isArray(groups)) return false;
  return groups.some(
    (group) => typeof group === "string" && PLATFORM_ADMIN_GROUPS.has(group.trim()),
  );
}
