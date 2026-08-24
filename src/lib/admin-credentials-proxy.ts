/**
 * Account creation and credential recovery.
 *
 *   POST /api/admin/user-credentials
 *     { action: "create",         email, firstName, lastName, … }
 *     { action: "reset-password", userId | email, sendEmail?, temporaryPassword? }
 *     { action: "resend-invite",  userId | email, temporaryPassword? }
 *
 * ## Why this exists
 *
 * These three flows ran in the browser, which required `cognito-idp:Admin*` on
 * the Identity Pool authenticated role. That single grant was a complete tenant
 * bypass, and the worst finding in the codebase:
 *
 * `AdminUpdateUserAttributes` is an IAM-authenticated admin API. It ignores the
 * app client's "custom:companyId is read-only" setting, which only governs the
 * user-facing `UpdateUserAttributes` call. So any signed-in user — a Driver
 * included — could rewrite their own company claim and then read that company's
 * loads, invoices and CRM through the API, legitimately, because the server
 * trusts the claim.
 *
 * Moving these here is what allows the grant to come off. The logic itself is
 * unchanged: it lives in `cognito-admin-core.ts` and is called with the server's
 * own principal.
 *
 * ## Who may do what
 *
 * Admin role required for all three. Beyond that:
 *
 * - **create** stamps the caller's own company. An admin cannot create a user
 *   into somebody else's tenant.
 * - **reset-password / resend-invite** require the target to already be in the
 *   caller's company. Password recovery for an arbitrary account is an account
 *   takeover primitive, not an administrative convenience.
 */
import { GetCommand } from "@aws-sdk/lib-dynamodb";

import { authorizeAdminRequest } from "@/lib/ai/ai-authz";
import { getAiDynamoClient, getProfileTable } from "@/lib/ai/server-aws";
import {
  ServerPrincipalMissingError,
  getServerCognitoClient,
  getServerUserPoolId,
} from "@/lib/ai/server-cognito";
import {
  adminCreateCognitoUser,
  adminResetCognitoPassword,
  resolveCognitoUsername,
  type CognitoAdminContext,
} from "@/lib/cognito-admin-core";
import { requireCurrentTenantContext } from "@/lib/tenant/request-context";
import {
  logTenantDenial,
  tenantErrorResponse,
  type TenantContext,
} from "@/lib/tenant/server-tenant-context";

const PATH = "/api/admin/user-credentials";
const MAX_BODY_BYTES = 20_000;

export function isAdminCredentialsRequest(url: URL, method: string) {
  return method === "POST" && url.pathname === PATH;
}

function jsonError(message: string, status: number, code?: string) {
  return Response.json({ error: message, code }, { status });
}

function asString(value: unknown, max = 300): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/**
 * The company a target already belongs to.
 *
 * Read from the Profile mirror rather than the token, because the target is not
 * the caller and has no token here. Drivers carry an employer instead.
 */
async function targetCompany(request: Request, userId: string): Promise<string | null> {
  const client = await getAiDynamoClient(request);
  const out = (await client.send(
    new GetCommand({
      TableName: getProfileTable(),
      Key: { userId, section: "permissions" },
    }) as never,
  )) as { Item?: { data?: { companyId?: string; employerCompanyId?: string } } };

  const data = out.Item?.data;
  if (!data) return null;
  return data.companyId ?? data.employerCompanyId ?? null;
}

export async function handleAdminCredentialsRequest(request: Request): Promise<Response> {
  let ctx: TenantContext;
  try {
    ctx = await requireCurrentTenantContext(request);
  } catch (err) {
    return tenantErrorResponse(err) ?? jsonError("Sign in required.", 401, "not_authenticated");
  }

  const authorized = await authorizeAdminRequest(request);
  if (!authorized.ok) {
    logTenantDenial(ctx, "credential administration by a non-admin", PATH);
    return jsonError("You do not have permission to manage accounts.", 403, "forbidden");
  }

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return jsonError("Request body too large.", 413, "payload_too_large");
  }

  let body: Record<string, unknown>;
  try {
    const parsed = (await request.json()) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return jsonError("Expected a JSON object.", 400, "invalid_payload");
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return jsonError("Invalid JSON body.", 400, "invalid_payload");
  }

  const action = asString(body.action, 40);
  if (!["create", "reset-password", "resend-invite"].includes(action)) {
    return jsonError("Unknown action.", 400, "invalid_payload");
  }

  let cognitoCtx: CognitoAdminContext;
  try {
    cognitoCtx = { client: getServerCognitoClient(), userPoolId: getServerUserPoolId() };
  } catch (err) {
    if (err instanceof ServerPrincipalMissingError) {
      console.error("[admin-credentials] server principal is not configured");
      return jsonError(
        "Server is not configured for administrative changes.",
        503,
        "server_principal_missing",
      );
    }
    throw err;
  }

  try {
    if (action === "create") {
      const email = asString(body.email, 320).toLowerCase();
      const firstName = asString(body.firstName, 100);
      const lastName = asString(body.lastName, 100);
      if (!email || !firstName || !lastName) {
        return jsonError("email, firstName and lastName are required.", 400, "invalid_payload");
      }

      // An admin with no company cannot place a new user anywhere. Platform
      // admins are exempt: onboarding a company means creating its first user
      // before belonging to it.
      if (!ctx.companyId && !ctx.isPlatformAdmin) {
        logTenantDenial(ctx, "user creation without a company", PATH);
        return jsonError(
          "Your account has no company assigned, so you cannot create users yet.",
          403,
          "no_company_context",
        );
      }

      const result = await adminCreateCognitoUser(cognitoCtx, {
        email,
        firstName,
        lastName,
        displayName: asString(body.displayName, 200) || undefined,
        phone: asString(body.phone, 40) || undefined,
        department: asString(body.department, 100) || undefined,
        jobTitle: asString(body.jobTitle, 150) || undefined,
        temporaryPassword: asString(body.temporaryPassword, 200) || undefined,
        sendEmailInvite: body.sendEmailInvite !== false,
      });

      console.info("[audit] user created", {
        actor: ctx.userId,
        actorRole: ctx.role,
        created: result.userId,
        intoCompany: ctx.companyId ?? null,
        at: new Date().toISOString(),
      });

      return Response.json({ ...result, companyId: ctx.companyId ?? null }, { status: 201 });
    }

    // reset-password / resend-invite — both need the target to be ours.
    const userId = asString(body.userId, 128);
    const email = asString(body.email, 320).toLowerCase();
    if (!userId && !email) {
      return jsonError("userId or email is required.", 400, "invalid_payload");
    }

    // Resolve first so an email-only request can still be company-checked.
    const resolved = await resolveCognitoUsername(cognitoCtx, { userId, email });
    const targetUserId = resolved.sub || userId;
    if (!targetUserId) {
      logTenantDenial(ctx, "credential action for an unresolvable user", PATH);
      return jsonError("User not found.", 404, "not_found");
    }

    if (!ctx.isPlatformAdmin) {
      const company = await targetCompany(request, targetUserId);
      if (!ctx.companyId || company !== ctx.companyId) {
        // Opaque. Resetting a password for an account outside your company is
        // account takeover, and confirming the account exists helps an attacker
        // enumerate. Unassigned targets are refused too — unlike the directory,
        // there is no bootstrap need that requires resetting a stranger.
        logTenantDenial(ctx, "credential action across companies", PATH);
        return jsonError("User not found.", 404, "not_found");
      }
    }

    const result = await adminResetCognitoPassword(cognitoCtx, {
      userId: targetUserId || undefined,
      email: email || resolved.email || undefined,
      sendEmail: action === "resend-invite" ? true : body.sendEmail !== false,
      temporaryPassword: asString(body.temporaryPassword, 200) || undefined,
    });

    console.info("[audit] credential action", {
      action,
      actor: ctx.userId,
      actorRole: ctx.role,
      target: targetUserId,
      method: result.method,
      emailed: result.emailed,
      at: new Date().toISOString(),
    });

    return Response.json(result);
  } catch (err) {
    const name = (err as { name?: string })?.name;
    const message = err instanceof Error ? err.message : String(err);
    console.error("[admin-credentials] request failed", name ?? "Error", message);

    // Cognito's own validation messages are safe to surface — they describe the
    // request, not another tenant's data — and an admin needs them to act.
    if (name === "UsernameExistsException" || name === "AliasExistsException") {
      return jsonError("An account with that email already exists.", 409, "already_exists");
    }
    if (name === "InvalidPasswordException" || name === "InvalidParameterException") {
      return jsonError(message, 400, "invalid_payload");
    }
    if (
      name === "AccessDeniedException" ||
      name === "NotAuthorizedException" ||
      name === "UnauthorizedException"
    ) {
      return jsonError(
        "Server is not permitted to create or recover Cognito accounts. Re-render titan-server-settings and attach it to the titan-worker IAM user.",
        503,
        "missing_cognito_permissions",
      );
    }
    if (name === "CodeDeliveryFailureException") {
      return jsonError(
        "Cognito could not send the invite email. Check the user pool email settings, or create the account with send invite turned off.",
        502,
        "invite_delivery_failed",
      );
    }
    return jsonError(message || "Could not complete that request.", 502, "error");
  }
}
