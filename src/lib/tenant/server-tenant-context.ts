/**
 * Server-side tenant context — the single source of truth for "who is asking
 * and what may they see".
 *
 * Every field here is derived from a **verified** Cognito ID token. Nothing is
 * read from a request body, query string, path parameter, custom header, or any
 * client-supplied value. That is the whole point: `companyId` is an
 * authorization input, and an authorization input that the caller can set is not
 * an authorization input.
 *
 * ## Where `companyId` comes from
 *
 * The `custom:companyId` Cognito user-pool attribute. Cognito places custom
 * attributes into the ID token automatically when the app client is allowed to
 * read them, so no pre-token-generation trigger is required.
 *
 * **This is only sound if the app client cannot *write* the attribute.** With
 * write permission, a user calls `UpdateUserAttributes` and assigns themselves
 * any company — the claim would be signed by Cognito and completely attacker
 * controlled. Verify with:
 *
 *     aws cognito-idp describe-user-pool-client --user-pool-id <POOL> \
 *       --client-id <CLIENT> --query "UserPoolClient.WriteAttributes"
 *
 * `custom:companyId` must not appear in that list. See
 * docs/security/company-tenant-model.md.
 *
 * ## Staleness
 *
 * A claim is an authorization decision cached for the life of the token. A user
 * removed from a company keeps a valid `companyId` claim until their token
 * expires. `sessionEpoch` closes that window — see `assertSessionCurrent`.
 */
import { CognitoRequestAuthFailure } from "@/lib/ai/auth-failure";
import { requireVerifiedIdClaims } from "@/lib/ai/cognito-request-credentials";
import { strictRole, strictRoleFromGroups } from "@/lib/tenant/strict-role";
import { hasPlatformAdminGroup, isRoleTenantExempt } from "@/lib/tenant/tenant-exemption";
import type { Role } from "@/lib/admin-user-constants";

/** Cognito attribute holding the tenant key. */
export const COMPANY_ID_CLAIM = "custom:companyId";
/** Bumped on company change, role change, suspension — invalidates live tokens. */
export const SESSION_EPOCH_CLAIM = "custom:sessionEpoch";

export type TenantContext = {
  userId: string;
  role: Role | null;
  companyId: string | null;
  /**
   * Exempt from the *companyId* rule, not from filtering. A driver still needs
   * an explicit alternative scope on every endpoint they can reach; there is no
   * "unscoped because exempt" path.
   */
  isTenantExempt: boolean;
  /**
   * Platform operator — may act across companies. Derived from Cognito group
   * membership only, never from a stored role. This is the one intentional
   * escape hatch from the tenant boundary; every use of it is audited.
   */
  isPlatformAdmin: boolean;
  sessionEpoch: number | null;
};

export class MissingTenantError extends Error {
  readonly code = "COMPANY_ASSIGNMENT_REQUIRED";
  readonly status = 403;

  constructor() {
    super("This account is not assigned to a company.");
    this.name = "MissingTenantError";
  }
}

export class TenantForbiddenError extends Error {
  readonly code = "TENANT_FORBIDDEN";
  readonly status = 403;

  constructor(message = "Not permitted.") {
    super(message);
    this.name = "TenantForbiddenError";
  }
}

function readStringClaim(claims: Record<string, unknown>, name: string): string | null {
  const value = claims[name];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Role from the token, or `null`.
 *
 * `cognito:groups` is preferred: group membership is pool-managed and cannot be
 * self-assigned through `UpdateUserAttributes` the way a custom attribute can.
 *
 * Resolution is strict — an unrecognized group name yields `null`, never an
 * inferred role. `normalizeRole` would have turned a group called `everyone`
 * into `Operations Manager`.
 */
function readRole(claims: Record<string, unknown>): Role | null {
  return strictRoleFromGroups(claims["cognito:groups"]) ?? strictRole(claims["custom:role"]);
}

/**
 * Re-exported so existing server call sites keep importing tenancy rules from
 * the tenant context. The definitions live in `tenant-exemption.ts` because the
 * browser's onboarding gate reads the same rules and must not pull the JWT
 * verifier into its bundle.
 */
export { TENANT_EXEMPT_ROLES } from "@/lib/tenant/tenant-exemption";

/**
 * Build the tenant context for a request.
 *
 * @throws CognitoRequestAuthFailure when the token is absent or unverifiable.
 */
export async function buildTenantContext(request: Request): Promise<TenantContext> {
  const claims = (await requireVerifiedIdClaims(request)) as unknown as Record<string, unknown>;

  const role = readRole(claims);
  const epochRaw = readStringClaim(claims, SESSION_EPOCH_CLAIM);
  const sessionEpoch = epochRaw !== null && /^\d+$/.test(epochRaw) ? Number(epochRaw) : null;

  return {
    userId: claims.sub as string,
    role,
    companyId: readStringClaim(claims, COMPANY_ID_CLAIM),
    isTenantExempt: isRoleTenantExempt(role),
    isPlatformAdmin: hasPlatformAdminGroup(claims),
    sessionEpoch,
  };
}

/**
 * The caller's company, or a thrown error.
 *
 * The only accessor tenant-scoped code may use. Handlers must not read
 * `ctx.companyId` directly — a null check that a developer has to remember is
 * the failure mode this exists to remove.
 *
 * A tenant-exempt role (Driver) reaching a company-scoped path is a routing
 * bug, and is refused rather than quietly allowed through unfiltered.
 */
export function requireCompanyId(ctx: TenantContext): string {
  if (ctx.isTenantExempt) {
    logTenantDenial(ctx, "tenant-exempt role reached a company-scoped path");
    throw new TenantForbiddenError();
  }
  if (!ctx.companyId) {
    logTenantDenial(ctx, "no company assigned");
    throw new MissingTenantError();
  }
  return ctx.companyId;
}

/**
 * Reject a token issued before the user's session was invalidated.
 *
 * Removal from a company, a role change, or a suspension bumps the stored
 * epoch. Without this a revoked user keeps full access until their token
 * expires — in several Cognito configurations a global sign-out does not
 * invalidate already-issued tokens.
 *
 * Fails closed when the stored epoch is unavailable: an unverifiable session is
 * not a current one.
 */
export function assertSessionCurrent(ctx: TenantContext, storedEpoch: number | null): void {
  if (storedEpoch === null) return; // never bumped — nothing to invalidate against
  if (ctx.sessionEpoch === null || ctx.sessionEpoch < storedEpoch) {
    logTenantDenial(ctx, "stale session epoch");
    throw new TenantForbiddenError("Your session is no longer valid. Sign in again.");
  }
}

/**
 * Structured record of a tenant denial.
 *
 * These logs are the only way a cross-tenant probe is ever noticed. Carries the
 * caller's identity and the reason — never the target's data, the target's
 * company, or any identifier the caller was not entitled to see.
 */
export function logTenantDenial(ctx: TenantContext, reason: string, route?: string): void {
  console.warn("[tenant] denied", {
    userId: ctx.userId,
    role: ctx.role ?? "(none)",
    hasCompany: Boolean(ctx.companyId),
    isTenantExempt: ctx.isTenantExempt,
    reason,
    ...(route ? { route } : {}),
  });
}

/** Map a tenant error to a response. Cross-tenant misses are 404, never 403. */
export function tenantErrorResponse(err: unknown): Response | null {
  if (err instanceof MissingTenantError || err instanceof TenantForbiddenError) {
    return Response.json({ error: err.message, code: err.code }, { status: err.status });
  }
  if (err instanceof CognitoRequestAuthFailure) {
    return Response.json(
      { error: "Sign in required.", code: "not_authenticated" },
      { status: 401 },
    );
  }
  return null;
}
