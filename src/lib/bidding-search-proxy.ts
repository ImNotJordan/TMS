/**
 * Lane search, run where the loads already are.
 *
 *   POST /api/bidding/search          { criteria, options } → aggregate rows
 *   GET  /api/bidding/field-options   distinct values for the search datalists
 *
 * ## Why this endpoint exists
 *
 * The bidding page used to call `GET /api/loads`, which returns every load the
 * company owns with no limit and no projection, and then aggregate in the
 * browser. Measured on this repo's own benchmark: 3.4MB of JSON at 10,000
 * loads, 16.9MB at 50,000, 67.8MB at 200,000 — fetched twice on mount and again
 * on every search, to produce a table that never shows more than a handful of
 * lane rows.
 *
 * The aggregation is the same code either way (`bidding-aggregate.ts` is pure
 * and shared); what changes is that the records stay server-side and only the
 * rows the screen renders cross the wire.
 *
 * ## What this does not fix
 *
 * The underlying Dynamo query is still "every load in the company", narrowed by
 * a projection to the dozen attributes the aggregator reads. Cutting the *read*
 * itself needs a lane-keyed index, which is a schema change and deliberately
 * out of scope here. This removes the payload, not the table read.
 */
import { QueryCommand } from "@aws-sdk/lib-dynamodb";

import {
  buildBackhaulCandidatesFromAws,
  buildHistoricalRowsFromLoads,
  buildLeverageLoadsFromAws,
  createEmptySearchCriteria,
  deriveLoadFieldOptions,
  getDisconnectedDatSnapshot,
  DEFAULT_SEARCH_OPTIONS,
  type SearchCriteria,
  type SearchOptions,
} from "@/lib/bidding-aggregate";
import type { LoadRecord } from "@/lib/loads-store";
import { getServerDataClient, ServerDataPrincipalMissingError } from "@/lib/server/server-dynamo";
import { readServerEnv } from "@/lib/server-env";
import { requireCurrentTenantContext } from "@/lib/tenant/request-context";
import { refuseClientOnOpsApi } from "@/lib/tenant/client-scope";
import { tenantErrorResponse, type TenantContext } from "@/lib/tenant/server-tenant-context";

const SEARCH_PATH = "/api/bidding/search";
const FIELD_OPTIONS_PATH = "/api/bidding/field-options";

const MAX_BODY_BYTES = 32_000;
/** A ceiling on how much history one search will consider. */
const MAX_LOADS_SCANNED = 50_000;

const COMPANY_ID_ATTRIBUTE = "companyId";

/**
 * Only what the aggregator reads.
 *
 * A `LoadRecord` carries ~60 attributes; the pricing engine touches twelve.
 * `carrierRate` and `customerRate` are the expensive ones to get wrong, so they
 * are named explicitly rather than relying on a wildcard.
 */
const LOAD_PROJECTION = [
  "loadId",
  "createdAt",
  "loadStatus",
  "customer",
  "broker",
  "equipmentType",
  "pickupCity",
  "pickupState",
  "pickupDate",
  "deliveryCity",
  "deliveryState",
  "deliveryDate",
  "carrierRate",
  "customerRate",
  "assignedCarrier",
] as const;

/** `status` and `date` are Dynamo reserved words in some SDK paths; alias all. */
const PROJECTION_NAMES = Object.fromEntries(
  LOAD_PROJECTION.map((field) => [`#${field}`, field]),
) as Record<string, string>;
const PROJECTION_EXPRESSION = LOAD_PROJECTION.map((field) => `#${field}`).join(", ");

const NO_STORE = { "cache-control": "no-store, private" } as const;

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: NO_STORE });
}

function jsonError(message: string, status: number, code?: string) {
  return Response.json({ error: message, code }, { status, headers: NO_STORE });
}

export function isBiddingSearchRequest(url: URL, method: string): boolean {
  return url.pathname === SEARCH_PATH && method === "POST";
}

export function isBiddingFieldOptionsRequest(url: URL, method: string): boolean {
  return url.pathname === FIELD_OPTIONS_PATH && method === "GET";
}

function loadsTable(): string {
  return readServerEnv("VITE_LOADS_TABLE_NAME") || "Loads";
}

/** Same index the loads repository uses — see `loads-api-proxy.ts`. */
const COMPANY_INDEX = "companyId-index";

/**
 * The caller's company's loads, projected down to the pricing attributes.
 *
 * Stops at `MAX_LOADS_SCANNED` so one enormous tenant cannot turn a search into
 * an unbounded read; the caller is told when that happened.
 */
async function listCompanyLoads(
  ctx: TenantContext,
): Promise<{ loads: LoadRecord[]; truncated: boolean }> {
  const companyId = ctx.companyId?.trim();
  if (!companyId) return { loads: [], truncated: false };

  const client = getServerDataClient();
  const loads: LoadRecord[] = [];
  let cursor: Record<string, unknown> | undefined;

  do {
    const page = (await client.send(
      new QueryCommand({
        TableName: loadsTable(),
        IndexName: COMPANY_INDEX,
        KeyConditionExpression: `${COMPANY_ID_ATTRIBUTE} = :companyId`,
        ExpressionAttributeValues: { ":companyId": companyId },
        ExpressionAttributeNames: PROJECTION_NAMES,
        ProjectionExpression: PROJECTION_EXPRESSION,
        ...(cursor ? { ExclusiveStartKey: cursor } : {}),
      }) as never,
    )) as { Items?: LoadRecord[]; LastEvaluatedKey?: Record<string, unknown> };

    if (page.Items?.length) loads.push(...page.Items);
    cursor = page.LastEvaluatedKey;

    if (loads.length >= MAX_LOADS_SCANNED) {
      return { loads: loads.slice(0, MAX_LOADS_SCANNED), truncated: true };
    }
  } while (cursor);

  return { loads, truncated: false };
}

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

/** Coerce the request into a criteria object — never trust its shape. */
function toCriteria(input: unknown): SearchCriteria {
  const base = createEmptySearchCriteria();
  if (!input || typeof input !== "object") return base;
  const raw = input as Record<string, unknown>;
  const out = { ...base };

  for (const key of Object.keys(base) as Array<keyof SearchCriteria>) {
    const value = raw[key];
    if (typeof base[key] === "number") {
      const n = Number(value);
      (out[key] as number) = Number.isFinite(n) ? Math.max(0, Math.min(n, 10_000_000)) : 0;
    } else if (typeof value === "string") {
      (out[key] as string) = value.slice(0, 200);
    }
  }
  return out;
}

function toOptions(input: unknown): SearchOptions {
  const base = { ...DEFAULT_SEARCH_OPTIONS };
  if (!input || typeof input !== "object") return base;
  const raw = input as Record<string, unknown>;
  for (const key of Object.keys(base) as Array<keyof SearchOptions>) {
    if (typeof raw[key] === "boolean") base[key] = raw[key];
  }
  return base;
}

export async function handleBiddingSearchRequest(request: Request): Promise<Response> {
  let ctx: TenantContext;
  try {
    ctx = await requireCurrentTenantContext(request);
  } catch (err) {
    return tenantErrorResponse(err) ?? jsonError("Sign in required.", 401, "not_authenticated");
  }

  const refused = refuseClientOnOpsApi(ctx, SEARCH_PATH);
  if (refused) return refused;

  try {
    const body = await readBody(request);
    if (body instanceof Response) return body;

    const criteria = toCriteria(body.criteria);
    const options = toOptions(body.options);
    const dat = getDisconnectedDatSnapshot();

    const { loads, truncated } = await listCompanyLoads(ctx);

    const results = buildHistoricalRowsFromLoads(loads, criteria, options, dat);
    const similarActiveLoads = buildLeverageLoadsFromAws(loads, criteria, options);
    const backhaulCandidates = buildBackhaulCandidatesFromAws(loads, criteria, options);

    return json({
      results,
      similarActiveLoads,
      backhaulCandidates,
      loadsConsidered: loads.length,
      matchedLoads: results.reduce((sum, row) => sum + row.loadCount, 0),
      truncated,
    });
  } catch (err) {
    return errorResponse(err, "search");
  }
}

export async function handleBiddingFieldOptionsRequest(request: Request): Promise<Response> {
  let ctx: TenantContext;
  try {
    ctx = await requireCurrentTenantContext(request);
  } catch (err) {
    return tenantErrorResponse(err) ?? jsonError("Sign in required.", 401, "not_authenticated");
  }

  const refused = refuseClientOnOpsApi(ctx, FIELD_OPTIONS_PATH);
  if (refused) return refused;

  try {
    const { loads } = await listCompanyLoads(ctx);
    return json(deriveLoadFieldOptions(loads));
  } catch (err) {
    return errorResponse(err, "field-options");
  }
}

function errorResponse(err: unknown, op: string): Response {
  if (err instanceof ServerDataPrincipalMissingError) {
    console.error("[bidding-search] data principal is not configured");
    return jsonError("Server is not configured for data access.", 503, err.code);
  }
  if ((err as { name?: string })?.name === "ResourceNotFoundException") {
    return jsonError("Loads table is not available.", 503, "table_missing");
  }
  console.error(`[bidding-search] ${op} failed`, err instanceof Error ? err.message : err);
  return jsonError("Could not complete that request.", 502, "error");
}
