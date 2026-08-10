/**
 * The tenant context every server handler should use.
 *
 * `buildTenantContext` reads the token. This adds the half a token cannot tell
 * you: whether the session behind it is still valid.
 *
 * ## Why a token alone is not enough
 *
 * A claim is an authorization decision frozen at issue time. Remove a user from
 * a company and their existing token still says they belong to it — Cognito will
 * happily keep verifying it until it expires, and in several configurations a
 * global sign-out does not invalidate already-issued tokens either. Without a
 * revocation check, "remove this user" means "in up to an hour".
 *
 * The stored `sessionEpoch` closes that. Assignment bumps it; any token carrying
 * a lower value is refused.
 *
 * ## Cost
 *
 * None, in the common case. The epoch rides along with the role lookup that
 * authorization already performs, and shares its 60-second cache. That cache TTL
 * is therefore also the revocation window: seconds, rather than the lifetime of
 * a token.
 */
import { resolveRequestRole } from "@/lib/ai/ai-authz";
import {
  TenantForbiddenError,
  assertSessionCurrent,
  buildTenantContext,
  type TenantContext,
} from "@/lib/tenant/server-tenant-context";

/**
 * Verified tenant context for a request, with the session confirmed current.
 *
 * @throws CognitoRequestAuthFailure when the token is absent or unverifiable.
 * @throws TenantForbiddenError when the session has been revoked.
 */
export async function requireCurrentTenantContext(request: Request): Promise<TenantContext> {
  const ctx = await buildTenantContext(request);

  const resolved = await resolveRequestRole(request);
  if (!resolved.ok) {
    // The role lookup failing is already a denial in `resolveRequestRole`; not
    // being able to establish the stored epoch is the same class of problem.
    throw new TenantForbiddenError(resolved.message);
  }

  assertSessionCurrent(ctx, resolved.sessionEpoch);
  return ctx;
}
