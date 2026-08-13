/**
 * Role assignment, synced to Cognito groups.
 *
 * `POST /api/admin/user-role  { userId, role }`
 *
 * ## Why this is a server endpoint
 *
 * The whole value of syncing roles into groups is that groups cannot be forged.
 * `permissions.role` in the Profile table is writable by any browser holding
 * Identity Pool credentials; `cognito:groups` can only change through
 * `AdminAddUserToGroup`, which no browser holds and must never hold.
 *
 * Doing this in the browser would require granting that action to the Identity
 * Pool role, which would let any signed-in user put themselves in `superadmin`
 * and read every company's data. That is not a smaller version of this feature —
 * it is the opposite of it.
 *
 * ## Who may grant what
 *
 * 1. **Admins only**, and only within their own company.
 * 2. **Nobody grants themselves a role.** Self-service role change is
 *    escalation with extra steps, whatever the current role is.
 * 3. **Only a platform admin may grant or revoke a privileged role.**
 *    `superadmin` confers cross-company reach; an ordinary company admin
 *    handing it out would breach the tenant boundary from inside.
 *
 * ## Ordering
 *
 * Cognito first, Profile second. The group is authoritative — it lands in the
 * token — so if the mirror fails the grant still stands and the caller is told.
 * The session epoch is bumped because groups are baked into the ID token: until
 * the target signs in again their old token carries the old groups.
 */
import {
  AdminAddUserToGroupCommand,
  AdminListGroupsForUserCommand,
  AdminRemoveUserFromGroupCommand,
  AdminUpdateUserAttributesCommand,
  CreateGroupCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

import { authorizeAdminRequest, invalidateCachedRole } from "@/lib/ai/ai-authz";
import { getAiDynamoClient, getProfileTable } from "@/lib/ai/server-aws";
import {
  ServerPrincipalMissingError,
  getServerCognitoClient,
  getServerUserPoolId,
} from "@/lib/ai/server-cognito";
import { ROLES, roleToStorageKey, type Role } from "@/lib/admin-user-constants";
import { requireCurrentTenantContext } from "@/lib/tenant/request-context";
import {
  isManagedRoleGroup,
  isPrivilegedRole,
  isPrivilegedRoleGroup,
  roleGroupName,
  sameRoleGroup,
} from "@/lib/tenant/role-groups";
import { strictRole } from "@/lib/tenant/strict-role";
import {
  SESSION_EPOCH_CLAIM,
  logTenantDenial,
  tenantErrorResponse,
  type TenantContext,
} from "@/lib/tenant/server-tenant-context";

const PATH = "/api/admin/user-role";

export function isUserRoleRequest(url: URL, method: string) {
  return method === "POST" && url.pathname === PATH;
}

function jsonError(message: string, status: number, code?: string) {
  return Response.json({ error: message, code }, { status });
}

function nextSessionEpoch(current: number | null): string {
  return String(Math.max(Date.now(), (current ?? 0) + 1));
}

type TargetState = {
  companyId: string | null;
  employerCompanyId: string | null;
  role: Role | null;
  sessionEpoch: number | null;
};

/** The target's current stored state. Read before any write. */
async function readTarget(request: Request, userId: string): Promise<TargetState | null> {
  const client = await getAiDynamoClient(request);
  const out = (await client.send(
    new GetCommand({
      TableName: getProfileTable(),
      Key: { userId, section: "permissions" },
    }) as never,
  )) as {
    Item?: {
      data?: {
        role?: string;
        companyId?: string;
        employerCompanyId?: string;
        sessionEpoch?: number;
      };
    };
  };

  if (!out.Item) return null;
  const data = out.Item.data ?? {};
  return {
    companyId: data.companyId ?? null,
    employerCompanyId: data.employerCompanyId ?? null,
    role: strictRole(data.role),
    sessionEpoch: typeof data.sessionEpoch === "number" ? data.sessionEpoch : null,
  };
}

/**
 * Make the target's group membership exactly `{ desired }` among managed groups.
 *
 * Removes the other managed groups rather than only adding the new one —
 * otherwise a user promoted from Dispatcher to Admin would keep both, and any
 * check that reads the first matching group would get an arbitrary answer.
 * Unmanaged groups are left alone; this endpoint does not own them.
 */
async function listGroups(
  cognito: ReturnType<typeof getServerCognitoClient>,
  userPoolId: string,
  username: string,
): Promise<string[]> {
  const current = await cognito.send(
    new AdminListGroupsForUserCommand({ UserPoolId: userPoolId, Username: username }),
  );
  return (current.Groups ?? []).map((g) => g.GroupName).filter(Boolean) as string[];
}

async function syncGroups(
  cognito: ReturnType<typeof getServerCognitoClient>,
  userPoolId: string,
  username: string,
  desired: string,
  names: string[],
): Promise<void> {
  for (const name of names) {
    // Compared by the role a name resolves to, not by spelling. `SuperAdmin`
    // and `superadmin` are one grant; an exact-string check left the old one
    // attached and the demotion revoked nothing.
    if (sameRoleGroup(name, desired)) continue;
    if (!isManagedRoleGroup(name)) continue;
    await cognito.send(
      new AdminRemoveUserFromGroupCommand({
        UserPoolId: userPoolId,
        Username: username,
        GroupName: name,
      }),
    );
  }

  // Only skip the add when the canonical name is already present. A
  // differently-spelled equivalent was just removed above, so membership
  // converges on one name over time.
  if (names.includes(desired)) return;

  try {
    await cognito.send(
      new AdminAddUserToGroupCommand({
        UserPoolId: userPoolId,
        Username: username,
        GroupName: desired,
      }),
    );
  } catch (err) {
    // A pool that has never had this group yet. Create it and retry, so an
    // admin does not have to hand-provision ten groups before the first
    // assignment works.
    if ((err as { name?: string })?.name !== "ResourceNotFoundException") throw err;
    await cognito.send(
      new CreateGroupCommand({
        UserPoolId: userPoolId,
        GroupName: desired,
        Description: `Role group managed by Titan (${desired})`,
      }),
    );
    await cognito.send(
      new AdminAddUserToGroupCommand({
        UserPoolId: userPoolId,
        Username: username,
        GroupName: desired,
      }),
    );
  }
}

export async function handleUserRoleRequest(request: Request): Promise<Response> {
  let ctx: TenantContext;
  try {
    ctx = await requireCurrentTenantContext(request);
  } catch (err) {
    return tenantErrorResponse(err) ?? jsonError("Sign in required.", 401, "not_authenticated");
  }

  const authorized = await authorizeAdminRequest(request);
  if (!authorized.ok) {
    logTenantDenial(ctx, "role assignment by a non-admin", PATH);
    return jsonError("You do not have permission to change roles.", 403, "forbidden");
  }

  let body: { userId?: unknown; role?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError("Invalid JSON body.", 400, "invalid_payload");
  }

  const targetUserId = typeof body.userId === "string" ? body.userId.trim() : "";
  const requestedRole = strictRole(body.role);

  if (!targetUserId) return jsonError("userId is required.", 400, "invalid_payload");
  if (!requestedRole) {
    // Resolved strictly. A fuzzy resolver would map an unexpected string onto a
    // real role, and the closest match to garbage should never be a grant.
    return jsonError(`role must be one of: ${ROLES.join(", ")}.`, 400, "invalid_payload");
  }

  // Rule 2: no self-service role change, at any level.
  if (targetUserId === ctx.userId) {
    logTenantDenial(ctx, "attempted to change their own role", PATH);
    return jsonError(
      "You cannot change your own role. Ask another administrator.",
      403,
      "self_assignment",
    );
  }

  let cognito;
  try {
    cognito = getServerCognitoClient();
  } catch (err) {
    if (err instanceof ServerPrincipalMissingError) {
      console.error("[admin-role] server principal is not configured");
      return jsonError(
        "Server is not configured for administrative changes.",
        503,
        "server_principal_missing",
      );
    }
    throw err;
  }
  const userPoolId = getServerUserPoolId();

  let target: TargetState | null;
  try {
    target = await readTarget(request, targetUserId);
  } catch (err) {
    console.error("[admin-role] could not read target", (err as { name?: string })?.name ?? err);
    return jsonError("Could not load that user.", 502, "error");
  }
  if (!target) {
    logTenantDenial(ctx, "role target not found", PATH);
    return jsonError("User not found.", 404, "not_found");
  }

  // Rule 1: same company. Opaque 404 — confirming the user exists but belongs
  // to someone else leaks membership of a company the caller cannot see.
  if (!ctx.isPlatformAdmin) {
    const targetCompany = target.companyId ?? target.employerCompanyId;
    if (!ctx.companyId || (targetCompany && targetCompany !== ctx.companyId)) {
      logTenantDenial(ctx, "role change on a user outside the caller's company", PATH);
      return jsonError("User not found.", 404, "not_found");
    }
  }

  // Read the target's current groups once: the privilege check below needs
  // them, and so does the sync. The group — not the Profile mirror — is the
  // authoritative record of what this user actually holds.
  let currentGroups: string[];
  try {
    currentGroups = await listGroups(cognito, userPoolId, targetUserId);
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name === "UserNotFoundException") {
      logTenantDenial(ctx, "role target has no Cognito account", PATH);
      return jsonError("User not found.", 404, "not_found");
    }
    console.error("[admin-role] could not read current groups", name ?? err);
    return jsonError("Could not load that user.", 502, "error");
  }

  // Rule 3: privileged roles are a platform-admin act, in both directions.
  // Revoking matters as much as granting — otherwise a company admin could
  // demote the platform admin and take the system over by removing oversight.
  //
  // Checked against real group membership as well as the stored role, because
  // the mirror can be stale or absent while the group still confers privilege.
  const grantsPrivilege = isPrivilegedRole(requestedRole);
  const revokesPrivilege =
    Boolean(target.role && isPrivilegedRole(target.role)) ||
    currentGroups.some(isPrivilegedRoleGroup);
  if ((grantsPrivilege || revokesPrivilege) && !ctx.isPlatformAdmin) {
    logTenantDenial(
      ctx,
      `attempted to ${grantsPrivilege ? "grant" : "revoke"} a privileged role`,
      PATH,
    );
    return jsonError(
      "Only a platform administrator can grant or remove that role.",
      403,
      "privileged_role",
    );
  }

  const groupName = roleGroupName(requestedRole);
  const nextEpoch = nextSessionEpoch(target.sessionEpoch);

  try {
    // Cognito first — it is the authoritative copy.
    await syncGroups(cognito, userPoolId, targetUserId, groupName, currentGroups);

    // Groups are baked into the ID token, so the target keeps the old ones
    // until they re-authenticate. Bump the epoch to stop the stale token.
    try {
      await cognito.send(
        new AdminUpdateUserAttributesCommand({
          UserPoolId: userPoolId,
          Username: targetUserId,
          UserAttributes: [{ Name: SESSION_EPOCH_CLAIM, Value: nextEpoch }],
        }),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("sessionEpoch")) throw err;
      console.warn(
        "[admin-role] custom:sessionEpoch is not defined on the user pool — the role changed " +
          "but the target keeps their previous groups until their token expires.",
      );
    }
  } catch (err) {
    const name = (err as { name?: string })?.name;
    console.error("[admin-role] group sync failed", name ?? err);
    if (name === "AccessDeniedException") {
      return jsonError(
        "Server is not permitted to manage Cognito groups.",
        503,
        "missing_group_permissions",
      );
    }
    return jsonError("Could not update that user's role.", 502, "error");
  }

  // Mirror to the Profile row. Non-authoritative: a failure here leaves the
  // group correct, which is the copy that governs access.
  let mirrored = true;
  try {
    const client = await getAiDynamoClient(request);
    await client.send(
      new UpdateCommand({
        TableName: getProfileTable(),
        Key: { userId: targetUserId, section: "permissions" },
        UpdateExpression:
          "SET #data.#role = :role, #data.#sessionEpoch = :epoch, " +
          "#data.#roleSetBy = :by, #updatedAt = :now",
        ExpressionAttributeNames: {
          "#data": "data",
          "#role": "role",
          "#sessionEpoch": "sessionEpoch",
          "#roleSetBy": "roleSetBy",
          "#updatedAt": "updatedAt",
        },
        ExpressionAttributeValues: {
          ":role": roleToStorageKey(requestedRole),
          ":epoch": Number(nextEpoch),
          ":by": ctx.userId,
          ":now": new Date().toISOString(),
        },
      }) as never,
    );
  } catch (err) {
    mirrored = false;
    console.error(
      "[admin-role] profile mirror failed — the Cognito group is authoritative and was updated",
      err instanceof Error ? err.message : err,
    );
  }

  invalidateCachedRole(targetUserId);

  console.info("[audit] role assignment", {
    actor: ctx.userId,
    actorRole: ctx.role,
    target: targetUserId,
    from: target.role,
    to: requestedRole,
    group: groupName,
    privileged: grantsPrivilege || revokesPrivilege,
    byPlatformAdmin: ctx.isPlatformAdmin,
    sourceIp: request.headers.get("cf-connecting-ip") ?? null,
    at: new Date().toISOString(),
  });

  return Response.json({
    ok: true,
    userId: targetUserId,
    role: requestedRole,
    group: groupName,
    mirrored,
    tokenRefreshRequired: true,
  });
}
