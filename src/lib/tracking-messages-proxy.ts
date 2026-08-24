/**
 * Tracking messages — the dispatch/driver conversation attached to a load.
 *
 *   GET  /api/tracking-messages?loadId=L-1
 *   POST /api/tracking-messages       { loadId, from, text, ... }
 *
 * ## Inherited tenancy
 *
 * These records carry no `companyId`. They are keyed by `loadId`, and their
 * tenancy belongs to the load: if you may see the load, you may see its
 * messages. So every request authorizes the **parent** first and only then
 * touches the message table.
 *
 * Previously `listTrackingMessages(loadId)` queried on a client-supplied
 * `loadId` with no check at all — any load's conversation, attachments
 * included, to anyone signed in. The load id is still supplied by the caller
 * (it has to be), but it is now a *request* for access rather than a grant of
 * it.
 *
 * ## Two ways to qualify
 *
 * A load is visible to a company user when its `companyId` matches theirs, and
 * to a driver when its `assignedDriver` matches their sub. Drivers carry no
 * company, so a single company predicate would lock them out of the
 * conversation they are half of.
 */
import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

import { getServerDataClient, ServerDataPrincipalMissingError } from "@/lib/server/server-dynamo";
import { readServerEnv } from "@/lib/server-env";
import { requireCurrentTenantContext } from "@/lib/tenant/request-context";
import { refuseClientOnOpsApi } from "@/lib/tenant/client-scope";
import {
  logTenantDenial,
  tenantErrorResponse,
  type TenantContext,
} from "@/lib/tenant/server-tenant-context";

const PATH = "/api/tracking-messages";
const MAX_BODY_BYTES = 2_000_000;

/** Fields a caller may set on a message. Everything else is derived. */
const WRITABLE_FIELDS = new Set([
  "loadId",
  "messageId",
  "from",
  "text",
  "timestamp",
  "docKind",
  "fileName",
  "contentType",
  "assetId",
]);

/** Which `from` values each side of the conversation may claim. */
const DRIVER_SENDERS = new Set(["driver"]);
const OPS_SENDERS = new Set(["ops", "system"]);

function loadsTable() {
  return readServerEnv("VITE_LOADS_TABLE_NAME") || "Loads";
}

function messagesTable() {
  return readServerEnv("VITE_TRACKING_MESSAGES_TABLE_NAME") || "TrackingMessages";
}

export function isTrackingMessagesRequest(url: URL): boolean {
  return url.pathname === PATH;
}

function jsonError(message: string, status: number, code?: string) {
  return Response.json({ error: message, code }, { status });
}

/**
 * May this caller see this load?
 *
 * Reads the load itself rather than trusting anything on the request. Returns
 * false for a load that does not exist, so a caller cannot distinguish "no such
 * load" from "not yours" — the id space stays opaque either way.
 */
async function canAccessLoad(ctx: TenantContext, loadId: string): Promise<boolean> {
  const client = getServerDataClient();
  const out = (await client.send(
    new GetCommand({ TableName: loadsTable(), Key: { loadId } }) as never,
  )) as { Item?: { companyId?: string; assignedDriver?: string } };

  const load = out.Item;
  if (!load) return false;

  // Driver: the load must be assigned to them. Checked first because a driver
  // has no company for the other branch to compare.
  if (ctx.isTenantExempt) return Boolean(load.assignedDriver && load.assignedDriver === ctx.userId);

  // Company user: the load must belong to their company.
  return Boolean(ctx.companyId && load.companyId === ctx.companyId);
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

export async function handleTrackingMessagesRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);

  let ctx: TenantContext;
  try {
    ctx = await requireCurrentTenantContext(request);
  } catch (err) {
    return tenantErrorResponse(err) ?? jsonError("Sign in required.", 401, "not_authenticated");
  }

  const refused = refuseClientOnOpsApi(ctx, url.pathname);
  if (refused) return refused;

  try {
    switch (request.method) {
      case "GET": {
        const loadId = url.searchParams.get("loadId")?.trim();
        if (!loadId) return jsonError("loadId is required.", 400, "invalid_payload");

        if (!(await canAccessLoad(ctx, loadId))) {
          logTenantDenial(ctx, "tracking messages for an inaccessible load", PATH);
          return jsonError("Load not found.", 404, "not_found");
        }

        const client = getServerDataClient();
        const out = (await client.send(
          new QueryCommand({
            TableName: messagesTable(),
            KeyConditionExpression: "loadId = :loadId",
            ExpressionAttributeValues: { ":loadId": loadId },
            ScanIndexForward: true,
          }) as never,
        )) as { Items?: Record<string, unknown>[] };

        return Response.json({ messages: out.Items ?? [] });
      }

      case "POST": {
        const body = await readBody(request);
        if (body instanceof Response) return body;

        const loadId = typeof body.loadId === "string" ? body.loadId.trim() : "";
        if (!loadId) return jsonError("loadId is required.", 400, "invalid_payload");
        if (typeof body.text !== "string" || !body.text.trim()) {
          return jsonError("text is required.", 400, "invalid_payload");
        }

        const unexpected = Object.keys(body).filter((key) => !WRITABLE_FIELDS.has(key));
        if (unexpected.length > 0) {
          return jsonError(`Unexpected fields: ${unexpected.join(", ")}.`, 400, "invalid_payload");
        }

        if (!(await canAccessLoad(ctx, loadId))) {
          logTenantDenial(ctx, "tracking message write to an inaccessible load", PATH);
          return jsonError("Load not found.", 404, "not_found");
        }

        // `from` drives which side of the thread a bubble renders on, so it
        // cannot simply be overwritten — ops legitimately posts both "ops" and
        // "system" messages. But a driver claiming "ops" would put a forged
        // dispatcher message in their own thread, so each side gets only the
        // senders it is entitled to use.
        const allowed = ctx.isTenantExempt ? DRIVER_SENDERS : OPS_SENDERS;
        const from = typeof body.from === "string" ? body.from : "";
        if (!allowed.has(from)) {
          logTenantDenial(ctx, "tracking message with a disallowed sender", PATH);
          return jsonError("Invalid sender.", 400, "invalid_payload");
        }

        const timestamp =
          typeof body.timestamp === "string" ? body.timestamp : new Date().toISOString();
        const messageId =
          typeof body.messageId === "string" && body.messageId.trim()
            ? body.messageId.trim()
            : `${timestamp}#${crypto.randomUUID()}`;

        const item = {
          ...body,
          loadId,
          messageId,
          timestamp,
          from,
          // Real attribution, from the token — `from` is a display role, this is
          // who actually posted it.
          sentBy: ctx.userId,
        };

        const client = getServerDataClient();
        await client.send(
          new PutCommand({
            TableName: messagesTable(),
            Item: item,
            ConditionExpression: "attribute_not_exists(messageId)",
          }) as never,
        );

        return Response.json({ message: item }, { status: 201 });
      }

      case "DELETE": {
        // Dispatch-side only. The driver portal has no delete affordance, and a
        // driver removing a dispatcher's message would be a way to quietly edit
        // the record of a load.
        if (ctx.isTenantExempt) {
          logTenantDenial(ctx, "tracking message delete", PATH);
          return jsonError("Load not found.", 404, "not_found");
        }

        const loadId = url.searchParams.get("loadId")?.trim();
        const messageId = url.searchParams.get("messageId")?.trim();
        if (!loadId || !messageId) {
          return jsonError("loadId and messageId are required.", 400, "invalid_payload");
        }

        if (!(await canAccessLoad(ctx, loadId))) {
          logTenantDenial(ctx, "tracking message delete on an inaccessible load", PATH);
          return jsonError("Load not found.", 404, "not_found");
        }

        const client = getServerDataClient();
        await client.send(
          new DeleteCommand({
            TableName: messagesTable(),
            Key: { loadId, messageId },
          }) as never,
        );

        return new Response(null, { status: 204 });
      }

      default:
        return jsonError("Method not allowed.", 405);
    }
  } catch (err) {
    if (err instanceof ServerDataPrincipalMissingError) {
      console.error("[tracking-messages] data principal is not configured");
      return jsonError("Server is not configured for data access.", 503, err.code);
    }
    console.error("[tracking-messages] request failed", err instanceof Error ? err.message : err);
    return jsonError("Could not complete that request.", 502, "error");
  }
}
