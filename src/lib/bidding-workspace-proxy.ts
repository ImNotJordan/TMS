/**
 * Bidding workspace — a user's own quotes, saved searches and audit trail.
 *
 *   GET    /api/bidding-workspace[?auditLimit=n]
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
 * ## The audit trail is not the caller's to write
 *
 * Being confined to your own partition is not the same as being trusted inside
 * it. `recordType: "audit"` rows are what say which model priced a load, on
 * what inputs, at what final bid — so the server stamps their key, their
 * timestamp and their subject, refuses to overwrite one, and refuses to delete
 * one. A caller supplies the payload; they do not supply who did it or when.
 *
 * ## Reads are bounded
 *
 * A workspace accumulates audit rows for as long as the account exists. The
 * read path queries each record type separately with its own limit rather than
 * returning the whole partition, and says when it truncated.
 */
import { DeleteCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

import { getServerDataClient, ServerDataPrincipalMissingError } from "@/lib/server/server-dynamo";
import { readServerEnv } from "@/lib/server-env";
import { requireCurrentTenantContext } from "@/lib/tenant/request-context";
import { refuseClientOnOpsApi } from "@/lib/tenant/client-scope";
import {
  logTenantDenial,
  tenantErrorResponse,
  type TenantContext,
} from "@/lib/tenant/server-tenant-context";

const PATH = "/api/bidding-workspace";

/** Enforced against the bytes actually received, not a declared header. */
const MAX_BODY_BYTES = 256_000;
const MAX_ITEM_KEY_CHARS = 320;
const MAX_TEXT_CHARS = 4_000;
const MAX_RATE = 10_000_000;

/** Per-type read ceilings. Quotes and searches are bounded by use; audit is not. */
const DEFAULT_AUDIT_LIMIT = 50;
const MAX_AUDIT_LIMIT = 200;
const MAX_QUOTES = 500;
const MAX_SEARCHES = 200;

/** Set by the server from the token — rejected if a caller sends them. */
const SERVER_OWNED_FIELDS = ["workspaceId", "companyId", "createdBy"] as const;

/** Additionally server-owned on an audit row: its identity and its timestamp. */
const AUDIT_SERVER_OWNED_FIELDS = ["itemKey", "createdAt", "user"] as const;

const RECORD_TYPES = ["quote", "search", "audit"] as const;
type RecordType = (typeof RECORD_TYPES)[number];

/** `itemKey` prefixes must match the record type, so one kind cannot masquerade
 * as another and land in the wrong bucket of the snapshot. */
const KEY_PREFIX: Record<RecordType, string> = {
  quote: "quote#",
  search: "search#",
  audit: "audit#",
};

/**
 * What each record type may carry.
 *
 * The handler used to spread the request body wholesale, so the table would
 * store any attribute a caller invented — arbitrary documents under a real
 * workspace, billed to the account and invisible to every screen.
 */
const ALLOWED_FIELDS: Record<RecordType, readonly string[]> = {
  quote: [
    "itemKey",
    "recordType",
    "quoteId",
    "createdAt",
    "updatedAt",
    "status",
    "bidAmount",
    "buyRate",
    "margin",
    "originCity",
    "originState",
    "destinationCity",
    "destinationState",
    "equipmentType",
    "laneLabel",
    "internalNote",
    "riskModelId",
    "riskModelVersion",
    "riskScore",
    "riskLevel",
    "rfpId",
    "rfpLane",
    "finalBid",
    "searchCriteria",
  ],
  search: ["itemKey", "recordType", "searchName", "criteria", "createdAt", "updatedAt"],
  audit: [
    "itemKey",
    "recordType",
    "createdAt",
    "searchId",
    "user",
    "userDisplayName",
    "origin",
    "destination",
    "equipment",
    "date",
    "historicalAggregationTimestamp",
    "datRefreshTimestamp",
    "riskModelId",
    "riskModelVersion",
    "riskInputValues",
    "riskOutput",
    "aiSuggestionTimestamp",
    "finalSelectedBid",
    "actionTaken",
    "createdQuoteId",
    "attachedRfpId",
  ],
};

/** Numeric fields and the range each has to sit inside to be a real rate. */
const NUMERIC_BOUNDS: Record<string, { min: number; max: number }> = {
  bidAmount: { min: 0, max: MAX_RATE },
  buyRate: { min: 0, max: MAX_RATE },
  margin: { min: -MAX_RATE, max: MAX_RATE },
  riskScore: { min: 0, max: 100 },
};

function table() {
  return readServerEnv("VITE_BIDDING_WORKSPACE_TABLE_NAME") || "BiddingWorkspace";
}

export function isBiddingWorkspaceRequest(url: URL): boolean {
  return url.pathname === PATH;
}

/**
 * Quotes, buy rates and margins. Nothing between here and the browser should
 * keep a copy.
 */
const NO_STORE = {
  "cache-control": "no-store, private",
} as const;

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: NO_STORE });
}

function jsonError(message: string, status: number, code?: string) {
  return Response.json({ error: message, code }, { status, headers: NO_STORE });
}

/**
 * Read and parse the body, capped on the bytes that actually arrived.
 *
 * The cap used to read `content-length` and trust it, which is a header the
 * client writes — a request declaring 42 bytes could carry two megabytes, and a
 * streamed body declared nothing at all.
 */
async function readBody(request: Request): Promise<Record<string, unknown> | Response> {
  let raw: ArrayBuffer;
  try {
    raw = await request.arrayBuffer();
  } catch {
    return jsonError("Could not read the request body.", 400, "invalid_payload");
  }

  if (raw.byteLength > MAX_BODY_BYTES) {
    return jsonError("Request body too large.", 413, "payload_too_large");
  }

  try {
    const parsed = JSON.parse(new TextDecoder().decode(raw)) as unknown;
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

function recordTypeOf(body: Record<string, unknown>): RecordType | null {
  const value = typeof body.recordType === "string" ? body.recordType : "";
  return (RECORD_TYPES as readonly string[]).includes(value) ? (value as RecordType) : null;
}

/** Structural checks that apply before anything reaches the table. */
function validate(
  body: Record<string, unknown>,
  recordType: RecordType,
): { error: Response } | { itemKey: string } {
  const unknownFields = Object.keys(body).filter(
    (field) =>
      field !== "mode" &&
      field !== "expectedUpdatedAt" &&
      !ALLOWED_FIELDS[recordType].includes(field),
  );
  if (unknownFields.length > 0) {
    return {
      error: jsonError(
        `Unexpected field(s) for a ${recordType}: ${unknownFields.slice(0, 5).join(", ")}.`,
        400,
        "unknown_field",
      ),
    };
  }

  for (const [field, bounds] of Object.entries(NUMERIC_BOUNDS)) {
    if (!(field in body)) continue;
    const value = body[field];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return { error: jsonError(`${field} must be a finite number.`, 400, "invalid_number") };
    }
    if (value < bounds.min || value > bounds.max) {
      return {
        error: jsonError(
          `${field} must be between ${bounds.min} and ${bounds.max}.`,
          400,
          "out_of_range",
        ),
      };
    }
  }

  // The key is checked before the generic text rule so an over-long saved
  // search name reports as a key problem rather than as "some string is long".
  const keyCheck = validateItemKey(body, recordType);
  if (keyCheck && "error" in keyCheck) return keyCheck;

  for (const [field, value] of Object.entries(body)) {
    if (field === "itemKey") continue;
    if (typeof value === "string" && value.length > MAX_TEXT_CHARS) {
      return {
        error: jsonError(`${field} is longer than ${MAX_TEXT_CHARS} characters.`, 400, "too_long"),
      };
    }
  }

  return keyCheck ?? { itemKey: "" };
}

/** `null` for an audit record — the server builds those keys itself. */
function validateItemKey(
  body: Record<string, unknown>,
  recordType: RecordType,
): { error: Response } | { itemKey: string } | null {
  if (recordType === "audit") return null;

  const itemKey = typeof body.itemKey === "string" ? body.itemKey.trim() : "";
  if (!itemKey || !itemKey.startsWith(KEY_PREFIX[recordType])) {
    return { error: jsonError("Invalid item key.", 400, "invalid_payload") };
  }
  if (itemKey.length > MAX_ITEM_KEY_CHARS) {
    // DynamoDB caps a sort key at 1024 bytes; without this the failure surfaced
    // as a generic 502 rather than as the field problem it is.
    return {
      error: jsonError(
        `Item key is longer than ${MAX_ITEM_KEY_CHARS} characters.`,
        400,
        "item_key_too_long",
      ),
    };
  }
  // eslint-disable-next-line no-control-regex
  if (/[ -]/.test(itemKey)) {
    return { error: jsonError("Item key contains control characters.", 400, "invalid_payload") };
  }

  return { itemKey };
}

async function queryByPrefix(
  workspaceId: string,
  prefix: string,
  limit: number,
): Promise<{ items: Record<string, unknown>[]; truncated: boolean }> {
  const client = getServerDataClient();
  const items: Record<string, unknown>[] = [];
  let startKey: Record<string, unknown> | undefined;

  do {
    const out = (await client.send(
      new QueryCommand({
        TableName: table(),
        KeyConditionExpression: "workspaceId = :w AND begins_with(itemKey, :prefix)",
        ExpressionAttributeValues: { ":w": workspaceId, ":prefix": prefix },
        // Newest first, so a limit keeps the most recent rows rather than the
        // oldest ones.
        ScanIndexForward: false,
        Limit: Math.min(limit - items.length, limit),
        ...(startKey ? { ExclusiveStartKey: startKey } : {}),
      }) as never,
    )) as { Items?: Record<string, unknown>[]; LastEvaluatedKey?: Record<string, unknown> };

    items.push(...(out.Items ?? []));
    startKey = out.LastEvaluatedKey;

    if (items.length >= limit) {
      return { items: items.slice(0, limit), truncated: Boolean(startKey) || items.length > limit };
    }
  } while (startKey);

  return { items, truncated: false };
}

function auditLimitFrom(url: URL): number {
  const raw = Number(url.searchParams.get("auditLimit"));
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_AUDIT_LIMIT;
  return Math.min(Math.floor(raw), MAX_AUDIT_LIMIT);
}

export async function handleBiddingWorkspaceRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);

  let ctx: TenantContext;
  try {
    ctx = await requireCurrentTenantContext(request);
  } catch (err) {
    return tenantErrorResponse(err) ?? jsonError("Sign in required.", 401, "not_authenticated");
  }

  const refused = refuseClientOnOpsApi(ctx, url.pathname);
  if (refused) return refused;

  const workspaceId = workspaceKey(ctx);
  if (!workspaceId) {
    logTenantDenial(ctx, "bidding workspace without a subject", PATH);
    return jsonError("Sign in required.", 401, "not_authenticated");
  }

  try {
    switch (request.method) {
      case "GET": {
        const [quotes, searches, audit] = await Promise.all([
          queryByPrefix(workspaceId, KEY_PREFIX.quote, MAX_QUOTES),
          queryByPrefix(workspaceId, KEY_PREFIX.search, MAX_SEARCHES),
          queryByPrefix(workspaceId, KEY_PREFIX.audit, auditLimitFrom(url)),
        ]);

        return json({
          items: [...quotes.items, ...searches.items, ...audit.items],
          truncated: {
            quotes: quotes.truncated,
            searches: searches.truncated,
            audit: audit.truncated,
          },
        });
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

        const recordType = recordTypeOf(body);
        if (!recordType) return jsonError("Unknown record type.", 400, "invalid_payload");

        const checked = validate(body, recordType);
        if ("error" in checked) return checked.error;

        const mode = typeof body.mode === "string" ? body.mode : "put";
        const {
          mode: _mode,
          expectedUpdatedAt,
          ...record
        } = body as Record<string, unknown> & { expectedUpdatedAt?: unknown };

        if (recordType === "audit") {
          return writeAuditRecord(ctx, workspaceId, record);
        }

        let condition: string | undefined;
        const values: Record<string, unknown> = {};

        if (mode === "create") {
          condition = "attribute_not_exists(itemKey)";
        } else if (mode === "update") {
          condition = "attribute_exists(itemKey)";
          // Optimistic concurrency: without this, two tabs editing one quote
          // overwrite each other and neither is told.
          if (typeof expectedUpdatedAt === "string" && expectedUpdatedAt) {
            condition += " AND updatedAt = :expectedUpdatedAt";
            values[":expectedUpdatedAt"] = expectedUpdatedAt;
          }
        }

        const item = {
          ...record,
          itemKey: checked.itemKey,
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
              ...(Object.keys(values).length > 0 ? { ExpressionAttributeValues: values } : {}),
            }) as never,
          );
        } catch (err) {
          if ((err as { name?: string })?.name === "ConditionalCheckFailedException") {
            if (mode === "create") {
              return jsonError("That item already exists.", 409, "already_exists");
            }
            if (values[":expectedUpdatedAt"]) {
              return jsonError(
                "This quote changed in another tab or session. Reload it and try again.",
                409,
                "stale_write",
              );
            }
            return jsonError("Item not found.", 404, "not_found");
          }
          throw err;
        }

        return json({ item });
      }

      case "DELETE": {
        const itemKey = url.searchParams.get("itemKey")?.trim();
        if (!itemKey) return jsonError("itemKey is required.", 400, "invalid_payload");

        // The audit trail is append-only. Being scoped to your own partition is
        // not permission to erase the record of what you priced.
        if (itemKey.startsWith(KEY_PREFIX.audit)) {
          logTenantDenial(ctx, "attempt to delete a bidding audit record", PATH);
          return jsonError("Audit records cannot be deleted.", 403, "audit_immutable");
        }

        const client = getServerDataClient();
        await client.send(
          new DeleteCommand({
            TableName: table(),
            // Scoped by construction: the key includes the caller's own
            // workspace, so there is no row outside it this can reach.
            Key: { workspaceId, itemKey },
          }) as never,
        );

        return new Response(null, { status: 204, headers: NO_STORE });
      }

      default:
        return Response.json(
          { error: "Method not allowed.", code: "method_not_allowed" },
          { status: 405, headers: { ...NO_STORE, allow: "GET, PUT, DELETE" } },
        );
    }
  } catch (err) {
    if (err instanceof ServerDataPrincipalMissingError) {
      console.error("[bidding-workspace] data principal is not configured");
      return jsonError("Server is not configured for data access.", 503, err.code);
    }
    if ((err as { name?: string })?.name === "ResourceNotFoundException") {
      return jsonError("Workspace table is not available.", 503, "table_missing");
    }
    console.error("[bidding-workspace] request failed", err instanceof Error ? err.message : err);
    return jsonError("Could not complete that request.", 502, "error");
  }
}

/**
 * Write one audit row.
 *
 * Identity, timestamp and key are the server's; the caller supplies only what
 * happened. `attribute_not_exists` makes the trail append-only — an existing
 * row cannot be rewritten by replaying its key.
 */
async function writeAuditRecord(
  ctx: TenantContext,
  workspaceId: string,
  record: Record<string, unknown>,
): Promise<Response> {
  const rejected = AUDIT_SERVER_OWNED_FIELDS.filter((field) => field in record);
  if (rejected.length > 0) {
    logTenantDenial(ctx, `audit write carried server-owned fields: ${rejected.join(", ")}`, PATH);
    return jsonError(
      `These fields are set by the server on an audit record: ${rejected.join(", ")}.`,
      400,
      "server_owned_field",
    );
  }

  const searchId = typeof record.searchId === "string" ? record.searchId.slice(0, 64) : "";
  const createdAt = new Date().toISOString();
  const item = {
    ...record,
    itemKey: `audit#${createdAt}#${searchId || "none"}`,
    recordType: "audit" as const,
    createdAt,
    user: ctx.userId,
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
        ConditionExpression: "attribute_not_exists(itemKey)",
      }) as never,
    );
  } catch (err) {
    if ((err as { name?: string })?.name === "ConditionalCheckFailedException") {
      // Same millisecond, same search: the trail already has this entry.
      return json({ item });
    }
    throw err;
  }

  return json({ item });
}
