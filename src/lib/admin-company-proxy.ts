/**
 * Company assignment — the one place a user is bound to a tenant.
 *
 * `POST /api/admin/company-assignment  { userId, companyId, companyName }`
 *
 * ## Why this is a server endpoint
 *
 * `companyId` decides which company's data a user sees. Writing it is therefore
 * a privileged operation, and it happens here under the server's own IAM
 * principal rather than in the browser. That lets `cognito-idp:Admin*` come off
 * the Identity Pool authenticated role — the finding where every signed-in user,
 * drivers included, could rewrite any user's attributes.
 *
 * ## Two places, deliberately
 *
 * 1. `custom:companyId` on the Cognito user — the authoritative copy. It lands
 *    in the ID token as a signed claim, which is what server authorization
 *    reads.
 * 2. `permissions.companyId` / `companyName` in the Profile table — a mirror the
 *    admin directory lists from. Never read for an authorization decision.
 *
 * Cognito is written first. If the mirror fails the assignment still stands and
 * the caller is told, because the authoritative copy is the one that governs
 * access.
 *
 * ## Cross-tenant guard
 *
 * An admin may only assign to their **own** company, and may only move a user
 * who is currently in it. Without that rule an admin could push users into
 * another company — a cross-tenant write dressed up as an administrative one.
 */
import {
  AdminGetUserCommand,
  AdminUpdateUserAttributesCommand,
  ListUsersCommand,
  type AttributeType,
  type CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

import { authorizeAdminRequest } from "@/lib/ai/ai-authz";
import { getAiDynamoClient, getProfileTable } from "@/lib/ai/server-aws";
import { strictRole } from "@/lib/tenant/strict-role";
import { TENANT_EXEMPT_ROLES } from "@/lib/tenant/server-tenant-context";
import type { Role } from "@/lib/admin-user-constants";
import {
  ServerPrincipalMissingError,
  getServerCognitoClient,
  getServerUserPoolId,
} from "@/lib/ai/server-cognito";
import {
  COMPANY_ID_CLAIM,
  SESSION_EPOCH_CLAIM,
  logTenantDenial,
  tenantErrorResponse,
} from "@/lib/tenant/server-tenant-context";
import { requireCurrentTenantContext } from "@/lib/tenant/request-context";
import { invalidateCachedRole } from "@/lib/ai/ai-authz";

const MAX_COMPANY_ID_LENGTH = 128;
const MAX_COMPANY_NAME_LENGTH = 200;

export function isCompanyAssignmentRequest(url: URL, method: string) {
  return method === "POST" && url.pathname === "/api/admin/company-assignment";
}

function jsonError(message: string, status: number, code?: string) {
  return Response.json({ error: message, code }, { status });
}

type AssignmentBody = {
  userId?: unknown;
  companyId?: unknown;
  companyName?: unknown;
};

function readAttribute(attributes: AttributeType[] | undefined, name: string): string | null {
  const value = attributes?.find((attr) => attr.Name === name)?.Value?.trim();
  return value || null;
}

/**
 * Cognito subs are UUIDs. Validating the shape rather than escaping it keeps
 * caller input out of the `ListUsers` filter string entirely — that filter is a
 * query language, and interpolating an unvalidated value into it is injection.
 */
const SUB_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

type ResolvedTarget = {
  /** Cognito `Username` — what the admin APIs key on. */
  username: string;
  companyId: string | null;
  sessionEpoch: string | null;
};

/**
 * Find a user by the id the app carries around.
 *
 * The app identifies users by their Cognito `sub` (that is what
 * `getCurrentUser().userId` returns), but the admin APIs key on `Username`. In
 * this pool the two differ, because email sign-in makes Cognito generate its own
 * username. Try the id as a username first — cheap, and correct for pools where
 * they coincide — then fall back to looking it up by `sub`.
 *
 * Returns `null` when no such user exists.
 */
async function resolveTarget(
  cognito: CognitoIdentityProviderClient,
  userPoolId: string,
  userId: string,
): Promise<ResolvedTarget | null> {
  const fromAttributes = (username: string, attributes: AttributeType[] | undefined) => ({
    username,
    companyId: readAttribute(attributes, COMPANY_ID_CLAIM),
    sessionEpoch: readAttribute(attributes, SESSION_EPOCH_CLAIM),
  });

  try {
    const direct = (await cognito.send(
      new AdminGetUserCommand({ UserPoolId: userPoolId, Username: userId }),
    )) as { UserAttributes?: AttributeType[] };
    return fromAttributes(userId, direct.UserAttributes);
  } catch (err) {
    const name = err && typeof err === "object" ? (err as { name?: string }).name : undefined;
    if (name !== "UserNotFoundException") throw err;
  }

  if (!SUB_PATTERN.test(userId)) return null;

  const found = (await cognito.send(
    new ListUsersCommand({
      UserPoolId: userPoolId,
      Filter: `sub = "${userId}"`,
      Limit: 1,
    }),
  )) as { Users?: { Username?: string; Attributes?: AttributeType[] }[] };

  const user = found.Users?.[0];
  if (!user?.Username) return null;
  return fromAttributes(user.Username, user.Attributes);
}

/**
 * The target's stored role, or `null`.
 *
 * Read server-side rather than taken from the request: the caller must not get
 * to declare what role the user they are editing has.
 */
async function readTargetRole(request: Request, userId: string): Promise<Role | null> {
  try {
    const client = await getAiDynamoClient(request);
    const out = (await client.send(
      new GetCommand({
        TableName: getProfileTable(),
        Key: { userId, section: "permissions" },
      }) as never,
    )) as { Item?: { data?: { role?: unknown } } };
    return strictRole(out.Item?.data?.role);
  } catch (err) {
    console.error(
      "[admin] could not read the target's role",
      err instanceof Error ? err.message : err,
    );
    // Fail closed: an unknown role must not be treated as "not a Driver".
    throw err;
  }
}

/**
 * Monotonic session epoch. Bumping it invalidates every token issued earlier,
 * which is what makes a company change take effect in minutes rather than
 * whenever the access token happens to expire.
 */
function nextSessionEpoch(current: string | null): string {
  const parsed = current && /^\d+$/.test(current) ? Number(current) : 0;
  return String(parsed + 1);
}

export async function handleCompanyAssignmentRequest(request: Request): Promise<Response> {
  // 1. Who is asking — verified token, admin role, fail closed.
  const authz = await authorizeAdminRequest(request);
  if (!authz.ok) {
    return jsonError(authz.message, authz.code === "forbidden" ? 403 : 401, authz.code);
  }

  let ctx;
  try {
    // Not `buildTenantContext` — this also refuses a token issued before the
    // caller's own session was revoked.
    ctx = await requireCurrentTenantContext(request);
  } catch (err) {
    return tenantErrorResponse(err) ?? jsonError("Sign in required.", 401, "not_authenticated");
  }

  let body: AssignmentBody;
  try {
    body = (await request.json()) as AssignmentBody;
  } catch {
    return jsonError("Invalid JSON body.", 400, "invalid_payload");
  }

  const targetUserId = typeof body.userId === "string" ? body.userId.trim() : "";
  const companyId = typeof body.companyId === "string" ? body.companyId.trim() : "";
  const companyName = typeof body.companyName === "string" ? body.companyName.trim() : "";

  if (!targetUserId) {
    return jsonError("userId is required.", 400, "invalid_payload");
  }
  if (companyId.length > MAX_COMPANY_ID_LENGTH || companyName.length > MAX_COMPANY_NAME_LENGTH) {
    return jsonError("Company details are too long.", 400, "invalid_payload");
  }
  // An empty companyId means "remove from company" — allowed, but only for a
  // user the caller currently administers (checked below).
  if (companyId && !companyName) {
    return jsonError("companyName is required when assigning a company.", 400, "invalid_payload");
  }

  let cognito;
  try {
    cognito = getServerCognitoClient();
  } catch (err) {
    if (err instanceof ServerPrincipalMissingError) {
      console.error("[admin] company assignment attempted without a server principal");
      return jsonError(
        "Server is not configured for administrative changes.",
        503,
        "server_principal_missing",
      );
    }
    throw err;
  }

  const userPoolId = getServerUserPoolId();

  // 2. Resolve the target and read its current state. Also confirms the user
  //    exists before any write, so a bad userId cannot half-apply the change.
  let target: ResolvedTarget | null;
  try {
    target = await resolveTarget(cognito, userPoolId, targetUserId);
  } catch (err) {
    const name = err && typeof err === "object" ? (err as { name?: string }).name : undefined;
    console.error("[admin] could not read assignment target", name ?? err);
    return jsonError("Could not load that user.", 502, "error");
  }

  if (!target) {
    // 404 with no detail — the caller does not get to use this endpoint to
    // enumerate the user pool.
    logTenantDenial(ctx, "assignment target not found", "/api/admin/company-assignment");
    return jsonError("User not found.", 404, "not_found");
  }

  const { username, companyId: currentCompanyId, sessionEpoch: currentEpoch } = target;

  // Rule B: a Driver must never carry a companyId. Their access is scoped by
  // assignment, not tenancy — giving one a company would hand them that
  // company's entire dataset through the ordinary tenant filter.
  //
  // Removal (empty companyId) stays allowed: clearing a company off a user who
  // became a Driver is exactly the corrective action this rule wants.
  if (companyId) {
    let targetRole: Role | null;
    try {
      targetRole = await readTargetRole(request, targetUserId);
    } catch {
      return jsonError("Could not load that user.", 502, "error");
    }
    if (targetRole && TENANT_EXEMPT_ROLES.has(targetRole)) {
      logTenantDenial(
        ctx,
        `refused company assignment for tenant-exempt role ${targetRole}`,
        "/api/admin/company-assignment",
      );
      return jsonError(
        `${targetRole}s are not assigned to a company — their access is scoped to the loads ` +
          `assigned to them. Change their role first if this is not a ${targetRole}.`,
        409,
        "role_is_tenant_exempt",
      );
    }
  }

  // 3. Cross-tenant guard.
  //
  // A platform operator is exempt: onboarding a company means assigning its
  // first users before belonging to it, so a same-company rule makes the job
  // impossible. This is the one intentional escape hatch from the tenant
  // boundary — it is granted by Cognito group membership (not a stored role a
  // user could write), and every use is recorded below as a cross-company
  // action so the audit trail distinguishes it from ordinary administration.
  if (ctx.isPlatformAdmin) {
    if (companyId && companyId !== ctx.companyId) {
      console.info("[audit] platform admin acting across companies", {
        actor: ctx.userId,
        target: targetUserId,
        callerCompany: ctx.companyId ?? null,
        assigningTo: companyId,
      });
    }
  } else if (ctx.companyId) {
    // (a) The *target* belongs to another company. Must be opaque: confirming
    //     that this user exists but is somebody else's would leak membership of
    //     a company the caller has no business knowing about.
    if (currentCompanyId && currentCompanyId !== ctx.companyId) {
      logTenantDenial(ctx, "target belongs to another company", "/api/admin/company-assignment");
      return jsonError("User not found.", 404, "not_found");
    }

    // (b) The caller is assigning *to* a company that is not their own. This
    //     leaks nothing — they already know their own company — so say so
    //     plainly. Answering 404 here sends a legitimate admin hunting for a
    //     missing user when the real problem is the company they typed.
    if (companyId && companyId !== ctx.companyId) {
      logTenantDenial(
        ctx,
        "attempted assignment to a company the caller does not belong to",
        "/api/admin/company-assignment",
      );
      return jsonError(
        "You can only assign users to your own company. Pick your company from the list, " +
          "or ask an owner of the other company to add them.",
        403,
        "cross_company_assignment",
      );
    }
  } else {
    // Bootstrap: before any company exists there is no "own company" to check
    // against. Logged prominently — this is an open path that closes when a
    // platform-admin role exists. See docs/security/company-tenant-model.md.
    console.warn("[admin] company assignment by an admin with no company of their own", {
      by: ctx.userId,
      target: targetUserId,
    });
  }

  // 4. Write the authoritative copy, and bump the epoch so the target's existing
  //    tokens — which still carry the old company — stop being accepted.
  const nextEpoch = nextSessionEpoch(currentEpoch);
  const attributes: AttributeType[] = [
    { Name: COMPANY_ID_CLAIM, Value: companyId },
    { Name: SESSION_EPOCH_CLAIM, Value: nextEpoch },
  ];

  let revocationActive = true;
  try {
    await cognito.send(
      new AdminUpdateUserAttributesCommand({
        UserPoolId: userPoolId,
        Username: username,
        UserAttributes: attributes,
      }),
    );
  } catch (err) {
    const name = err && typeof err === "object" ? (err as { name?: string }).name : undefined;
    const message = err instanceof Error ? err.message : String(err);

    // The pool may not have `custom:sessionEpoch` yet. Retry with the company
    // alone rather than failing the assignment, but say clearly that revocation
    // is not in force — a stale token keeps the old company until it expires.
    if (name === "InvalidParameterException" && message.includes("sessionEpoch")) {
      console.warn(
        "[admin] custom:sessionEpoch is not defined on the user pool — assignment applied " +
          "WITHOUT revocation. The target keeps their previous company until their token " +
          "expires. Add the attribute to close this.",
      );
      revocationActive = false;
      await cognito.send(
        new AdminUpdateUserAttributesCommand({
          UserPoolId: userPoolId,
          Username: username,
          UserAttributes: [{ Name: COMPANY_ID_CLAIM, Value: companyId }],
        }),
      );
    } else {
      console.error("[admin] company assignment failed", name ?? message);
      return jsonError("Could not update that user.", 502, "error");
    }
  }

  // 5. Mirror to the Profile table for the admin directory. Non-authoritative —
  //    a failure here does not undo the assignment.
  let mirrored = true;
  try {
    const client = await getAiDynamoClient(request);
    await client.send(
      new UpdateCommand({
        TableName: getProfileTable(),
        Key: { userId: targetUserId, section: "permissions" },
        UpdateExpression: "SET #data = if_not_exists(#data, :empty)",
        ExpressionAttributeNames: { "#data": "data" },
        ExpressionAttributeValues: { ":empty": {} },
      }) as never,
    );
    await client.send(
      new UpdateCommand({
        TableName: getProfileTable(),
        Key: { userId: targetUserId, section: "permissions" },
        UpdateExpression:
          "SET #data.#companyId = :companyId, #data.#companyName = :companyName, " +
          "#data.#sessionEpoch = :epoch, #updatedAt = :now, #data.#assignedBy = :by",
        ExpressionAttributeNames: {
          "#data": "data",
          "#companyId": "companyId",
          "#companyName": "companyName",
          // Mirrored so the per-request revocation check is a cached Dynamo read
          // rather than a Cognito call on every request.
          "#sessionEpoch": "sessionEpoch",
          "#assignedBy": "companyAssignedBy",
          "#updatedAt": "updatedAt",
        },
        ExpressionAttributeValues: {
          ":companyId": companyId,
          ":companyName": companyName,
          ":epoch": Number(nextEpoch),
          ":now": new Date().toISOString(),
          ":by": ctx.userId,
        },
      }) as never,
    );
  } catch (err) {
    mirrored = false;
    console.error(
      "[admin] company assignment mirror to Profile failed — Cognito is authoritative and was updated",
      err instanceof Error ? err.message : err,
    );
  }

  // The target's cached role/epoch would otherwise keep their old session alive
  // for up to the cache TTL. Assignment is exactly when that must not happen.
  invalidateCachedRole(targetUserId);

  // 6. Audit. Identity of actor and target, never another company's data.
  console.info("[audit] company assignment", {
    action: companyId ? "assign" : "remove",
    actor: ctx.userId,
    actorRole: ctx.role,
    target: targetUserId,
    companyId: companyId || null,
    from: currentCompanyId || null,
    sourceIp: request.headers.get("cf-connecting-ip") ?? null,
    at: new Date().toISOString(),
    revocationActive,
    mirrored,
  });

  return Response.json({
    ok: true,
    userId: targetUserId,
    companyId: companyId || null,
    companyName: companyName || null,
    /**
     * The target's existing token still carries the previous claim. They must
     * re-authenticate before the change takes effect for them.
     */
    tokenRefreshRequired: true,
    revocationActive,
    mirrored,
  });
}
