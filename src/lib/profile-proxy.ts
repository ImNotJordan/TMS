/**
 * Profile sections.
 *
 *   GET /api/profile                          own, every section
 *   GET /api/profile?section=personal         own, one section
 *   GET /api/profile?userId=X[&section=…]     admin, same company only
 *   PUT /api/profile  { section, data }       own, sanitized
 *   PUT /api/profile  { userId, section, data }  admin, same company only
 *
 * ## Why this exists
 *
 * `UsersTable` was readable and writable by every signed-in browser. That meant
 * any user could `Scan` it and read every colleague's name, email, phone and
 * company across every tenant — and `PutItem` over any row. The self-service
 * sanitizer in `profile-schema.ts` ran in the browser, so it guarded accidents
 * and nothing else: a determined caller issued the raw write instead.
 *
 * Moving it here is what turns that sanitizer into a boundary, and lets the
 * table come off the Identity Pool role entirely.
 *
 * ## Two shapes of access
 *
 * **Self-service** is the default: no `userId` in the request means the caller's
 * own row, taken from the verified token. There is no way to name someone else
 * without also passing the admin checks below.
 *
 * **Administrative** access requires an admin role *and* that the target is in
 * the caller's company. It also skips the sanitizer — setting another user's
 * permissions is the entire point of an admin edit — with one exception noted
 * on `SERVER_OWNED_PERMISSION_FIELDS`.
 */
import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

import { authorizeAdminRequest } from "@/lib/ai/ai-authz";
import { getAiDynamoClient, getProfileTable } from "@/lib/ai/server-aws";
import {
  isSectionKey,
  sanitizeSelfServiceSection,
  type SectionKey,
} from "@/lib/profile-schema";
import { requireCurrentTenantContext } from "@/lib/tenant/request-context";
import { strictRole } from "@/lib/tenant/strict-role";
import {
  logTenantDenial,
  tenantErrorResponse,
  type TenantContext,
} from "@/lib/tenant/server-tenant-context";

const PATH = "/api/profile";
const MAX_BODY_BYTES = 400_000;

/**
 * Fields no HTTP caller may write, admin or not.
 *
 * These are owned by dedicated endpoints that do more than write a value:
 * `/api/admin/company-assignment` bumps the session epoch, `/api/admin/user-role`
 * syncs the Cognito group. Letting a profile save set them directly would leave
 * the authoritative copy — the token claim or the group — behind, and the two
 * would disagree silently.
 */
const SERVER_OWNED_PERMISSION_FIELDS: ReadonlySet<string> = new Set([
  "role",
  "companyId",
  "companyName",
  "employerCompanyId",
  "employerCompanyName",
  "sessionEpoch",
]);

export function isProfileRequest(url: URL, method: string) {
  return (method === "GET" || method === "PUT") && url.pathname === PATH;
}

function jsonError(message: string, status: number, code?: string) {
  return Response.json({ error: message, code }, { status });
}

/** The target's company, for the same-company check. */
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
  // Drivers carry an employer rather than a company — see directory-scope.ts.
  return data.companyId ?? data.employerCompanyId ?? null;
}

/**
 * Resolve which user this request is for, and refuse if it is not allowed.
 *
 * Returns the target id, or a Response to send back instead.
 */
async function resolveTarget(
  request: Request,
  ctx: TenantContext,
  requestedUserId: string | null,
): Promise<{ userId: string; isAdminAccess: boolean } | Response> {
  if (!requestedUserId || requestedUserId === ctx.userId) {
    return { userId: ctx.userId, isAdminAccess: false };
  }

  const authorized = await authorizeAdminRequest(request);
  if (!authorized.ok) {
    // Opaque: a non-admin asking about someone else learns nothing about
    // whether that someone exists.
    logTenantDenial(ctx, "profile access for another user by a non-admin", PATH);
    return jsonError("User not found.", 404, "not_found");
  }

  if (!ctx.isPlatformAdmin) {
    const company = await targetCompany(request, requestedUserId);
    if (!ctx.companyId || (company && company !== ctx.companyId)) {
      logTenantDenial(ctx, "profile access across companies", PATH);
      return jsonError("User not found.", 404, "not_found");
    }
    // A target with no company at all is still visible to an admin — the same
    // carve-out the directory makes, so an unassigned user stays administrable.
  }

  return { userId: requestedUserId, isAdminAccess: true };
}

async function readBody(request: Request): Promise<Record<string, unknown> | Response> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return jsonError("Request body too large.", 413, "payload_too_large");
  }
  try {
    const parsed = (await request.json()) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return jsonError("Expected a JSON object.", 400, "invalid_payload");
    }
    return parsed as Record<string, unknown>;
  } catch {
    return jsonError("Invalid JSON body.", 400, "invalid_payload");
  }
}

export async function handleProfileRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);

  let ctx: TenantContext;
  try {
    ctx = await requireCurrentTenantContext(request);
  } catch (err) {
    return tenantErrorResponse(err) ?? jsonError("Sign in required.", 401, "not_authenticated");
  }

  try {
    if (request.method === "GET") {
      const requested = url.searchParams.get("userId")?.trim() || null;
      const resolved = await resolveTarget(request, ctx, requested);
      if (resolved instanceof Response) return resolved;

      const sectionParam = url.searchParams.get("section")?.trim();
      const client = await getAiDynamoClient(request);

      if (sectionParam) {
        if (!isSectionKey(sectionParam)) {
          return jsonError("Unknown section.", 400, "invalid_payload");
        }
        const out = (await client.send(
          new GetCommand({
            TableName: getProfileTable(),
            Key: { userId: resolved.userId, section: sectionParam },
          }) as never,
        )) as { Item?: { data?: unknown; updatedAt?: string } };

        return Response.json({
          data: out.Item?.data ?? null,
          updatedAt: out.Item?.updatedAt ?? null,
        });
      }

      // Every section for this user. Query, never Scan — the partition key is
      // the user, so there is nothing to filter after the fact.
      const items: Array<{ section?: string; data?: unknown; updatedAt?: string }> = [];
      let startKey: Record<string, unknown> | undefined;
      do {
        const out = (await client.send(
          new QueryCommand({
            TableName: getProfileTable(),
            KeyConditionExpression: "userId = :u",
            ExpressionAttributeValues: { ":u": resolved.userId },
            ...(startKey ? { ExclusiveStartKey: startKey } : {}),
          }) as never,
        )) as {
          Items?: Array<{ section?: string; data?: unknown; updatedAt?: string }>;
          LastEvaluatedKey?: Record<string, unknown>;
        };
        items.push(...(out.Items ?? []));
        startKey = out.LastEvaluatedKey;
      } while (startKey);

      return Response.json({ sections: items });
    }

    // PUT
    const body = await readBody(request);
    if (body instanceof Response) return body;

    const requested = typeof body.userId === "string" ? body.userId.trim() : null;
    const resolved = await resolveTarget(request, ctx, requested);
    if (resolved instanceof Response) return resolved;

    const section = body.section;
    if (!isSectionKey(section)) {
      return jsonError("Unknown section.", 400, "invalid_payload");
    }
    const incoming =
      body.data && typeof body.data === "object" && !Array.isArray(body.data)
        ? (body.data as Record<string, unknown>)
        : null;
    if (!incoming) return jsonError("data must be an object.", 400, "invalid_payload");

    let data: Record<string, unknown>;

    if (resolved.isAdminAccess) {
      // An admin edit legitimately sets permissions, but never the fields that
      // belong to a dedicated endpoint.
      const stripped = Object.keys(incoming).filter(
        (key) => section === "permissions" && SERVER_OWNED_PERMISSION_FIELDS.has(key),
      );
      if (stripped.length > 0) {
        return jsonError(
          `Use the dedicated endpoint to change: ${stripped.join(", ")}.`,
          400,
          "server_owned_field",
        );
      }
      data = incoming;
    } else {
      const { data: sanitized, rejected } = sanitizeSelfServiceSection(
        section as SectionKey,
        incoming,
      );
      if (rejected.length > 0) {
        // A self-service surface tried to write its own privilege. Refused
        // outright rather than quietly dropped, so it shows up.
        logTenantDenial(ctx, `self-service write to privileged fields: ${rejected.join(",")}`, PATH);
        return jsonError(
          `These fields cannot be changed here: ${rejected.join(", ")}.`,
          403,
          "privileged_field",
        );
      }
      data = sanitized;
    }

    const merge = body.merge === true;
    const client = await getAiDynamoClient(request);

    // A write to `permissions` always carries the server-owned fields forward.
    //
    // Rejecting them when present is only half the rule: this is a full replace,
    // so *omitting* `role` deleted it — and `resolveRequestRole` reads exactly
    // that field, so an ordinary profile save silently stripped the user's role
    // and locked them out of everything it gated. Immutable has to mean
    // unsettable *and* undeletable.
    const needsCarryForward = section === "permissions" || merge;
    if (needsCarryForward) {
      const existing = (await client.send(
        new GetCommand({
          TableName: getProfileTable(),
          Key: { userId: resolved.userId, section },
        }) as never,
      )) as { Item?: { data?: Record<string, unknown> } };
      const previous = existing.Item?.data ?? {};

      if (merge) data = { ...previous, ...data };

      if (section === "permissions") {
        for (const field of SERVER_OWNED_PERMISSION_FIELDS) {
          if (previous[field] !== undefined) data[field] = previous[field];
        }
      }
    }

    const updatedAt = new Date().toISOString();
    await client.send(
      new PutCommand({
        TableName: getProfileTable(),
        Item: { userId: resolved.userId, section, data, updatedAt },
      }) as never,
    );

    if (resolved.isAdminAccess) {
      console.info("[audit] profile edited by an administrator", {
        actor: ctx.userId,
        actorRole: strictRole(ctx.role),
        target: resolved.userId,
        section,
        at: updatedAt,
      });
    }

    return Response.json({ data, updatedAt });
  } catch (err) {
    const name = err && typeof err === "object" ? (err as { name?: string }).name : undefined;
    console.error("[profile] request failed", name ?? err);
    return jsonError("Could not complete that request.", 502, "error");
  }
}
