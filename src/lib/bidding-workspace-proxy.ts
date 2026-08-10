/**
 * Bidding workspace — a user's own quotes, saved searches and audit trail.
 *
 *   GET    /api/bidding-workspace
 *   PUT    /api/bidding-workspace          { itemKey, recordType, … }
 *   DELETE /api/bidding-workspace?itemKey=…
 *
 * ## The workspace id is not an input
 *
 * The table is partitioned by `workspaceId`, and a workspace *is* a user — the
 * id is their Cognito sub. The client used to pass it:
 *
 *     const workspaceId = user?.userId ?? "_"     // bidding-page.tsx
 *
 * which made every read and write an IDOR. Substituting a colleague's sub — a
 * value visible in any admin list — returned their draft quotes, their saved
 * lanes, and their full bidding audit trail. Margins and buy rates, for anyone
 * who opened devtools.
 *
 * So this endpoint accepts no workspace id at all. It takes the caller's sub
 * from the verified token and uses that as the partition key, exactly as
 * `/api/driver/loads` does. There is no request a caller can construct that
 * reads someone else's workspace, because there is nowhere to put the id.
 *
 * `companyId` is stamped alongside for future company-level reporting; it is
 * never read from the request.
 */
import { DeleteCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

import { getServerDataClient, ServerDataPrincipalMissingError } from "@/lib/server/server-dynamo";
import { readServerEnv } from "@/lib/server-env";
import { requireCurrentTenantContext } from "@/lib/tenant/request-context";
import {
  logTenantDenial,
  tenantErrorResponse,
  type TenantContext,
} from "@/lib/tenant/server-tenant-context";

const PATH = "/api/bidding-workspace";
const MAX_BODY_BYTES = 1_000_000;

/** Set by the server from the token — rejected if a caller sends them. */
const SERVER_OWNED_FIELDS = ["workspaceId", "companyId", "createdBy"] as const;

const RECORD_TYPES = new Set(["quote", "search", "audit"]);

/** `itemKey` prefixes must match the record type, so one kind cannot masquerade
 * as another and land in the wrong bucket of the snapshot. */
const KEY_PREFIX: Record<string, string> = {
  quote: "quote#",
  search: "search#",
  audit: "audit#",
};

function table() {
  return readServerEnv("VITE_BIDDING_WORKSPACE_TABLE_NAME") || "BiddingWorkspace";
}

export function isBiddingWorkspaceRequest(url: URL): boolean {
  return url.pathname === PATH;
}

function jsonError(message: string, status: number, code?: string) {
  return Response.json({ error: message, code }, { status });
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

/**
 * The caller's own workspace key. Never derived from the request.
 *
 * A missing sub is a broken token, not an anonymous workspace — the old client
 * fell back to the literal `"_"`, which would have been a shared workspace that
 * anyone signed out into. There is no fallback here.
 */
function workspaceKey(ctx: TenantContext): string | null {
  return ctx.userId?.trim() || null;
}

export async function handleBiddingWorkspaceRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);

  let ctx: TenantContext;
  try {
    ctx = await requireCurrentTenantContext(request);
  } catch (err) {
    return tenantErrorResponse(err) ?? jsonError("Sign in required.", 401, "not_authenticated");
  }

  const workspaceId = workspaceKey(ctx);
  if (!workspaceId) {
    logTenantDenial(ctx, "bidding workspace without a subject", PATH);
    return jsonError("Sign in required.", 401, "not_authenticated");
  }

  try {
    switch (request.method) {
      case "GET": {
        const client = getServerDataClient();
        const items: Record<string, unknown>[] = [];
        let startKey: Record<string, unknown> | undefined;

        do {
          const out = (await client.send(
            new QueryCommand({
              TableName: table(),
              KeyConditionExpression: "workspaceId = :w",
              ExpressionAttributeValues: { ":w": workspaceId },
              ScanIndexForward: false,
              ...(startKey ? { ExclusiveStartKey: startKey } : {}),
            }) as never,
          )) as {
            Items?: Record<string, unknown>[];
            LastEvaluatedKey?: Record<string, unknown>;
          };
          items.push(...(out.Items ?? []));
          startKey = out.LastEvaluatedKey;
        } while (startKey);

        return Response.json({ items });
      }

      case "PUT": {
        const body = await readBody(request);
        if (body instanceof Response) return body;

        const present = SERVER_OWNED_FIELDS.filter((field) => field in body);
        if (present.length > 0) {
          // Rejected, not ignored: an attempt to set the partition key is worth
          // seeing rather than silently correcting.
          logTenantDenial(ctx, "bidding workspace write with server-owned fields", PATH);
          return jsonError(
            `These fields are set by the server: ${present.join(", ")}.`,
            400,
            "server_owned_field",
          );
        }

        const recordType = typeof body.recordType === "string" ? body.recordType : "";
        if (!RECORD_TYPES.has(recordType)) {
          return jsonError("Unknown record type.", 400, "invalid_payload");
        }

        const itemKey = typeof body.itemKey === "string" ? body.itemKey.trim() : "";
        if (!itemKey || !itemKey.startsWith(KEY_PREFIX[recordType])) {
          return jsonError("Invalid item key.", 400, "invalid_payload");
        }

        // "create" and "update" carry the same conditions the direct writes did.
        const mode = typeof body.mode === "string" ? body.mode : "put";
        const condition =
          mode === "create"
            ? "attribute_not_exists(itemKey)"
            : mode === "update"
              ? "attribute_exists(itemKey)"
              : undefined;

        const { mode: _mode, ...record } = body;
        const item = {
          ...record,
          itemKey,
          recordType,
          workspaceId,
          createdBy: ctx.userId,
          ...(ctx.companyId ? { companyId: ctx.companyId } : {}),
        };

        const client = getServerDataClient();
        try {
          await client.send(
            new PutCommand({
              TableName: table(),
              Item: item,
              ...(condition ? { ConditionExpression: condition } : {}),
            }) as never,
          );
        } catch (err) {
          if ((err as { name?: string })?.name === "ConditionalCheckFailedException") {
            return jsonError("Item not found.", 404, "not_found");
          }
          throw err;
        }

        return Response.json({ item });
      }

      case "DELETE": {
        const itemKey = url.searchParams.get("itemKey")?.trim();
        if (!itemKey) return jsonError("itemKey is required.", 400, "invalid_payload");

        const client = getServerDataClient();
        await client.send(
          new DeleteCommand({
            TableName: table(),
            // Scoped by construction: the key includes the caller's own
            // workspace, so there is no row outside it this can reach.
            Key: { workspaceId, itemKey },
          }) as never,
        );

        return new Response(null, { status: 204 });
      }

      default:
        return jsonError("Method not allowed.", 405);
    }
  } catch (err) {
    if (err instanceof ServerDataPrincipalMissingError) {
      console.error("[bidding-workspace] data principal is not configured");
      return jsonError("Server is not configured for data access.", 503, err.code);
    }
    if ((err as { name?: string })?.name === "ResourceNotFoundException") {
      return jsonError("Workspace table is not available.", 503, "table_missing");
    }
    console.error(
      "[bidding-workspace] request failed",
      err instanceof Error ? err.message : err,
    );
    return jsonError("Could not complete that request.", 502, "error");
  }
}
