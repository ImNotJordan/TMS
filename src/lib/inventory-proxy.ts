/**
 * Inventory: the SKU catalogue and the stock ledger.
 *
 *   GET    /api/inventory/items          the caller's company's SKUs
 *   POST   /api/inventory/items          create a SKU (opens at zero stock)
 *   GET    /api/inventory/items/:id      one SKU, 404 unless it is theirs
 *   PATCH  /api/inventory/items/:id      edit descriptive fields
 *   DELETE /api/inventory/items/:id      delete, only at zero stock
 *   GET    /api/inventory/movements      the stock ledger
 *   POST   /api/inventory/movements      post a movement (the only way stock moves)
 *
 * ## Why this is a handler and not a registry entry
 *
 * Eleven tenant-scoped tables are served by `api/resource-proxy` from a data
 * list, and adding two more rows there would have been a five-line change.
 * It would also have been wrong. That handler's contract is "any field the
 * caller sends, we store" — correct for a quote or a carrier, fatal for stock:
 * `PATCH {"quantityOnHand": 5000}` would move five thousand units with no
 * ledger row, no reason, and no attribution. The ledger would still reconcile
 * against itself and disagree with reality, which is worse than having no
 * ledger, because a report drawn from it looks trustworthy.
 *
 * So quantities are refused on every ordinary write (`INVENTORY_LEDGER_OWNED_FIELDS`)
 * and move only through `POST /movements`, which computes them.
 *
 * Everything the registry guarantees still holds, because the same repository
 * enforces it: the tenant comes from the verified token, listing goes through
 * `companyId-index` and never a Scan, cross-tenant misses answer 404 with no
 * detail, and no AWS error text reaches the client.
 *
 * ## Posting a movement without transactions
 *
 * A movement is two writes — append the ledger row, move the stock — and
 * `tenant-repository` deliberately exposes no multi-item transaction. So the
 * ledger row is written *first*, in `pending`, and promoted to `posted` only
 * after the stock write lands:
 *
 *   1. read the item, scoped                     → 404 if not theirs
 *   2. `applyMovement` (shared with the UI)       → 422 if it breaks an invariant
 *   3. write the ledger row as `pending`
 *   4. update the item, preconditioned on the exact quantities read in (1)
 *        → on failure, mark the row `rejected` and answer 409
 *   5. promote the row to `posted` with the resulting levels
 *
 * The precondition in (4) is what makes this safe under concurrency. Two
 * dispatchers shipping the same pallet do not interleave: the second one's
 * `expect` no longer matches, it is refused with 409, and its ledger row is
 * marked `rejected` naming why. Reading, checking and writing without that
 * precondition is the classic oversell — both requests see 10 on hand, both ship
 * 8, and the table ends up at 2.
 *
 * A crash between (3) and (4) leaves a `pending` row and unchanged stock; a
 * crash between (4) and (5) leaves a `pending` row and changed stock. Neither is
 * silent — `pending` rows surface in the ledger view as unsettled, which is the
 * property that matters. A design where the failure mode is a missing row is one
 * where the discrepancy is invisible.
 */
import {
  RecordAlreadyExistsError,
  RecordNotFoundError,
  RecordPreconditionFailedError,
  createTenantRepository,
} from "@/lib/server/tenant-repository";
import { ServerDataPrincipalMissingError } from "@/lib/server/server-dynamo";
import { requireCurrentTenantContext } from "@/lib/tenant/request-context";
import { refuseClientOnOpsApi } from "@/lib/tenant/client-scope";
import { logTenantDenial, tenantErrorResponse, type TenantContext } from "@/lib/tenant/server-tenant-context";
import {
  checkModuleAccess,
  hasFieldPermission,
  moduleAccessResponse,
} from "@/lib/tenant/module-access";
import {
  checkInventoryItemCreate,
  checkInventoryItemDelete,
  checkInventoryItemUpdate,
  checkInventoryMovement,
  roleCanValueInventory,
  type InventoryWriteCheck,
} from "@/lib/tenant/inventory-permissions";
import {
  INVENTORY_ITEM_STATUSES,
  INVENTORY_MOVEMENT_KINDS,
  applyMovement,
  isInventoryItemStatus,
  isInventoryMovementKind,
  roundMoney,
  roundQuantity,
  type InventoryItemRecord,
  type InventoryMovementRecord,
} from "@/lib/inventory-domain";
import {
  parseLoadInventoryLines,
  planLoadInventoryMovements,
} from "@/lib/load-inventory";
import { readServerEnv } from "@/lib/server-env";

const PATH_PREFIX = "/api/inventory";

/** GSI every tenant-scoped table carries. Movements add `createdAt` as its sort key. */
const COMPANY_INDEX = "companyId-index";

/** Set by the server on every record. A request that supplies one is refused. */
const SERVER_OWNED_FIELDS = ["companyId", "createdBy", "createdAt", "updatedAt"] as const;

const MAX_BODY_BYTES = 200_000;

/** Long enough for a real description, short enough that the table stays a table. */
const MAX_TEXT_LENGTH = 2_000;
const MAX_SHORT_TEXT_LENGTH = 200;

function itemsTable(): string {
  return readServerEnv("VITE_INVENTORY_ITEMS_TABLE_NAME") || "InventoryItems";
}

function movementsTable(): string {
  return readServerEnv("VITE_INVENTORY_MOVEMENTS_TABLE_NAME") || "InventoryMovements";
}

const items = createTenantRepository<InventoryItemRecord>({
  table: itemsTable,
  idKey: "itemId",
  label: "Inventory item",
  companyIndex: COMPANY_INDEX,
});

const movements = createTenantRepository<InventoryMovementRecord>({
  table: movementsTable,
  idKey: "movementId",
  label: "Inventory movement",
  companyIndex: COMPANY_INDEX,
});

type PostedMovementInput = {
  itemId: string;
  kind: InventoryMovementRecord["kind"];
  quantity: number;
  reason?: string;
  reference?: string;
  notes?: string;
};

type PostedMovementResult =
  | { ok: true; movement: InventoryMovementRecord; item: InventoryItemRecord }
  | { ok: false; status: number; code: string; message: string };

/**
 * One ledger row + one stock write. Shared by the public movements POST and by
 * load-sync so a booked load cannot allocate through a second arithmetic.
 */
async function executePostedMovement(
  ctx: TenantContext,
  input: PostedMovementInput,
): Promise<PostedMovementResult> {
  const item = await items.get(ctx, input.itemId);
  if (!item) {
    return { ok: false, status: 404, code: "not_found", message: "Inventory item not found." };
  }
  if (item.status === "Archived") {
    return {
      ok: false,
      status: 409,
      code: "item_not_writable",
      message: "This SKU is archived. Set it back to Active before moving stock.",
    };
  }

  const effect = applyMovement(
    { quantityOnHand: item.quantityOnHand ?? 0, quantityAllocated: item.quantityAllocated ?? 0 },
    { kind: input.kind, quantity: input.quantity },
  );
  if (!effect.ok) {
    return { ok: false, status: 422, code: effect.code, message: effect.message };
  }

  const nowIso = new Date().toISOString();
  const movementId = crypto.randomUUID();
  const pending = await movements.create(ctx, {
    movementId,
    itemId: input.itemId,
    sku: item.sku,
    itemName: item.name,
    kind: input.kind,
    quantity: roundQuantity(input.quantity),
    onHandDelta: effect.onHandDelta,
    allocatedDelta: effect.allocatedDelta,
    resultingOnHand: effect.next.quantityOnHand,
    resultingAllocated: effect.next.quantityAllocated,
    warehouse: item.warehouse,
    reason: input.reason?.trim().slice(0, MAX_SHORT_TEXT_LENGTH) || undefined,
    reference: input.reference?.trim().slice(0, MAX_SHORT_TEXT_LENGTH) || undefined,
    notes: input.notes?.trim().slice(0, MAX_TEXT_LENGTH) || undefined,
    postedState: "pending",
    actorRole: ctx.role ?? undefined,
  } as Omit<InventoryMovementRecord, "createdAt" | "updatedAt" | "companyId">);

  let updatedItem: InventoryItemRecord;
  try {
    updatedItem = await items.update(
      ctx,
      input.itemId,
      {
        quantityOnHand: effect.next.quantityOnHand,
        quantityAllocated: effect.next.quantityAllocated,
        lastMovementAt: nowIso,
        ...(input.kind === "count" ? { lastCountedAt: nowIso } : {}),
      },
      {
        expect: {
          quantityOnHand: item.quantityOnHand ?? 0,
          quantityAllocated: item.quantityAllocated ?? 0,
        },
        staleMessage:
          "This SKU's stock changed while the movement was being posted. Reload and try again.",
      },
    );
  } catch (err) {
    const reason =
      err instanceof RecordPreconditionFailedError
        ? "Stock changed between the check and the write."
        : err instanceof RecordNotFoundError
          ? "The SKU was removed before the movement could post."
          : "The stock update failed.";
    await movements
      .update(ctx, movementId, { postedState: "rejected", rejectedReason: reason })
      .catch((markErr) => {
        console.error(
          "[inventory] could not mark movement rejected",
          markErr instanceof Error ? markErr.message : markErr,
        );
      });
    if (err instanceof RecordPreconditionFailedError || err instanceof RecordNotFoundError) {
      return { ok: false, status: err.status, code: err.code, message: err.message };
    }
    throw err;
  }

  const posted = await movements.update(ctx, movementId, {
    postedState: "posted",
    resultingOnHand: updatedItem.quantityOnHand,
    resultingAllocated: updatedItem.quantityAllocated,
  });

  return { ok: true, movement: posted ?? pending, item: updatedItem };
}

export type LoadInventorySyncResult =
  | { ok: true }
  | { ok: false; status: number; code: string; message: string };

/**
 * Make the warehouse match this load: allocate, ship, or release.
 *
 * Called from the loads API after a write. Inventory movers are not re-checked
 * here — attaching freight to a load *is* the movement, and the load write
 * already decided who may do that. The ledger invariants still run.
 */
export async function syncLoadInventoryForTenant(
  ctx: TenantContext,
  load: { loadId: string; loadStatus?: string | null; inventoryLines?: unknown },
  options?: { previous?: { inventoryLines?: unknown } | null },
): Promise<LoadInventorySyncResult> {
  const loadId = load.loadId?.trim();
  if (!loadId) {
    return { ok: false, status: 400, code: "invalid_payload", message: "loadId is required." };
  }

  const lines = parseLoadInventoryLines(load.inventoryLines);
  const previousLines = parseLoadInventoryLines(options?.previous?.inventoryLines);
  const ledger = await movements.list(ctx);
  const plan = planLoadInventoryMovements({
    loadId,
    status: load.loadStatus,
    lines,
    previousLines,
    movements: ledger,
  });
  if (!plan.ok) {
    return { ok: false, status: 422, code: plan.code, message: plan.message };
  }
  if (plan.movements.length === 0) return { ok: true };

  for (const step of plan.movements) {
    let result = await executePostedMovement(ctx, step);
    if (!result.ok && result.code === "STALE_RECORD") {
      result = await executePostedMovement(ctx, step);
    }
    if (!result.ok) return result;
  }
  return { ok: true };
}

/* ------------------------------------------------------------------ *
 * Routing
 * ------------------------------------------------------------------ */

type Route = { kind: "items"; id: string | null } | { kind: "movements"; id: string | null };

function parsePath(url: URL): Route | null {
  const segments = url.pathname.split("/").filter(Boolean);
  // api / inventory / <collection> [/ <id>]
  if (segments[0] !== "api" || segments[1] !== "inventory") return null;
  if (segments.length < 3 || segments.length > 4) return null;

  const id = segments[3] ? decodeURIComponent(segments[3]).trim() || null : null;
  if (segments[2] === "items") return { kind: "items", id };
  if (segments[2] === "movements") return { kind: "movements", id };
  return null;
}

export function isInventoryApiRequest(url: URL): boolean {
  return url.pathname === PATH_PREFIX || url.pathname.startsWith(`${PATH_PREFIX}/`);
}

/* ------------------------------------------------------------------ *
 * Payload handling
 * ------------------------------------------------------------------ */

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

function rejectServerOwnedFields(body: Record<string, unknown>): Response | null {
  const offending = SERVER_OWNED_FIELDS.filter((field) => field in body);
  if (offending.length === 0) return null;
  return jsonError(
    `These fields are set by the server and cannot be supplied: ${offending.join(", ")}.`,
    400,
    "server_owned_field",
  );
}

function denialResponse(check: InventoryWriteCheck): Response | null {
  if (check.ok) return null;
  return Response.json(
    { error: check.message, code: check.code, ...(check.fields ? { fields: check.fields } : {}) },
    { status: check.status },
  );
}

/**
 * Coerce a whitelisted item payload.
 *
 * An allowlist rather than a passthrough: the resource registry stores whatever
 * arrives because its tables are shape-agnostic, but stock is arithmetic and a
 * `reorderPoint` of `"12"` that silently becomes a string breaks every
 * comparison downstream. Unknown keys are dropped rather than rejected so an
 * older client sending a retired field keeps working.
 */
type ItemFieldSpec = { key: keyof InventoryItemRecord; type: "string" | "number" | "boolean" };

const ITEM_FIELDS: ItemFieldSpec[] = [
  { key: "sku", type: "string" },
  { key: "name", type: "string" },
  { key: "description", type: "string" },
  { key: "category", type: "string" },
  { key: "warehouse", type: "string" },
  { key: "binLocation", type: "string" },
  { key: "unitOfMeasure", type: "string" },
  { key: "reorderPoint", type: "number" },
  { key: "reorderQuantity", type: "number" },
  { key: "unitCost", type: "number" },
  { key: "unitPrice", type: "number" },
  { key: "supplierName", type: "string" },
  { key: "supplierSku", type: "string" },
  { key: "hazmat", type: "boolean" },
  { key: "temperatureControlled", type: "boolean" },
  { key: "temperatureRange", type: "string" },
  { key: "weightPerUnitLb", type: "number" },
  { key: "status", type: "string" },
  { key: "notes", type: "string" },
];

const LONG_TEXT_FIELDS: ReadonlySet<string> = new Set(["description", "notes"]);

type Coerced = { ok: true; value: Record<string, unknown> } | { ok: false; message: string };

function coerceItemFields(body: Record<string, unknown>): Coerced {
  const out: Record<string, unknown> = {};

  for (const spec of ITEM_FIELDS) {
    const key = spec.key as string;
    if (!(key in body)) continue;
    const raw = body[key];
    if (raw === null) continue;

    if (spec.type === "string") {
      if (typeof raw !== "string") return { ok: false, message: `${key} must be a string.` };
      const trimmed = raw.trim();
      const limit = LONG_TEXT_FIELDS.has(key) ? MAX_TEXT_LENGTH : MAX_SHORT_TEXT_LENGTH;
      if (trimmed.length > limit) {
        return { ok: false, message: `${key} must be ${limit} characters or fewer.` };
      }
      out[key] = trimmed;
      continue;
    }

    if (spec.type === "number") {
      const parsed = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
      if (typeof parsed !== "number" || !Number.isFinite(parsed)) {
        return { ok: false, message: `${key} must be a number.` };
      }
      if (parsed < 0) return { ok: false, message: `${key} cannot be negative.` };
      out[key] =
        key === "unitCost" || key === "unitPrice" ? roundMoney(parsed) : roundQuantity(parsed);
      continue;
    }

    if (typeof raw !== "boolean") return { ok: false, message: `${key} must be true or false.` };
    out[key] = raw;
  }

  if (out.status !== undefined && !isInventoryItemStatus(out.status)) {
    return {
      ok: false,
      message: `status must be one of: ${INVENTORY_ITEM_STATUSES.join(", ")}.`,
    };
  }

  return { ok: true, value: out };
}

/**
 * Reject a SKU already used in this company.
 *
 * One indexed query on a path that runs when someone types a new part number —
 * not on the movement path, which is the hot one. A composite partition key
 * (`companyId#sku`) would make this a real atomic constraint rather than a
 * best-effort check, at the cost of making a SKU rename a delete-and-recreate
 * and putting the tenant id in every URL. The trade was made the other way:
 * losing this race duplicates a row, which is a data-quality problem a human
 * fixes, and the alternative bakes the tenant into the key space forever.
 */
async function skuIsTaken(
  ctx: Awaited<ReturnType<typeof requireCurrentTenantContext>>,
  sku: string,
  exceptItemId?: string,
): Promise<boolean> {
  const normalized = sku.trim().toLowerCase();
  if (!normalized) return false;
  const existing = await items.list(ctx);
  return existing.some(
    (row) => row.itemId !== exceptItemId && (row.sku ?? "").trim().toLowerCase() === normalized,
  );
}

/**
 * Drop cost and price for a caller not entitled to the valuation.
 *
 * Redacted server-side rather than hidden client-side, because a column the
 * browser declines to render is still sitting in the JSON — one devtools panel
 * away from the dispatcher who was not supposed to see the margin. Entitlement
 * is either the role (`INVENTORY_VALUERS`) or the explicit
 * "Can View Inventory Valuation" toggle in the admin console.
 *
 * The write side needs no equivalent: `checkInventoryItem*` already refuses a
 * payload carrying these fields from a role that may not set them, so an
 * unentitled caller cannot write back what they were never shown.
 */
function redactValuation(item: InventoryItemRecord): InventoryItemRecord {
  const { unitCost: _cost, unitPrice: _price, ...rest } = item;
  return rest as InventoryItemRecord;
}

/* ------------------------------------------------------------------ *
 * Items
 * ------------------------------------------------------------------ */

async function handleItems(
  request: Request,
  url: URL,
  ctx: Awaited<ReturnType<typeof requireCurrentTenantContext>>,
  id: string | null,
): Promise<Response> {
  switch (request.method) {
    case "GET": {
      const mayValue =
        roleCanValueInventory(ctx.role) ||
        (await hasFieldPermission(request, ctx, "Can View Inventory Valuation"));
      const project = (item: InventoryItemRecord) => (mayValue ? item : redactValuation(item));

      if (!id) return Response.json({ items: (await items.list(ctx)).map(project) });
      const record = await items.get(ctx, id);
      if (!record) {
        logTenantDenial(ctx, "inventory item not found or not in company", url.pathname);
        return jsonError("Inventory item not found.", 404, "not_found");
      }
      return Response.json({ item: project(record) });
    }

    case "POST": {
      if (id) return jsonError("Method not allowed.", 405);
      const body = await readBody(request);
      if (body instanceof Response) return body;

      const serverOwned = rejectServerOwnedFields(body);
      if (serverOwned) {
        logTenantDenial(ctx, "inventory create carried server-owned fields", url.pathname);
        return serverOwned;
      }

      const gate = denialResponse(checkInventoryItemCreate(ctx, body));
      if (gate) {
        logTenantDenial(ctx, "role denied inventory create", url.pathname);
        return gate;
      }

      const coerced = coerceItemFields(body);
      if (!coerced.ok) return jsonError(coerced.message, 400, "invalid_payload");

      const fields = coerced.value;
      const sku = typeof fields.sku === "string" ? fields.sku : "";
      const name = typeof fields.name === "string" ? fields.name : "";
      if (!sku) return jsonError("sku is required.", 400, "invalid_payload");
      if (!name) return jsonError("name is required.", 400, "invalid_payload");

      if (await skuIsTaken(ctx, sku)) {
        return jsonError(`SKU ${sku} already exists.`, 409, "duplicate_sku");
      }

      const created = await items.create(ctx, {
        // Server-generated: a client-chosen partition key is a collision — or an
        // overwrite attempt against another company's id space — that the client
        // controls.
        itemId: crypto.randomUUID(),
        ...fields,
        sku,
        name,
        warehouse:
          typeof fields.warehouse === "string" && fields.warehouse
            ? fields.warehouse
            : "Unassigned",
        unitOfMeasure:
          typeof fields.unitOfMeasure === "string" && fields.unitOfMeasure
            ? fields.unitOfMeasure
            : "Each",
        // Stock opens empty. Seeding it is a `receipt`, so the first units in
        // have a ledger row like every unit after them.
        quantityOnHand: 0,
        quantityAllocated: 0,
        reorderPoint: typeof fields.reorderPoint === "number" ? fields.reorderPoint : 0,
        reorderQuantity: typeof fields.reorderQuantity === "number" ? fields.reorderQuantity : 0,
        unitCost: typeof fields.unitCost === "number" ? fields.unitCost : 0,
        unitPrice: typeof fields.unitPrice === "number" ? fields.unitPrice : 0,
        status: isInventoryItemStatus(fields.status) ? fields.status : "Active",
      } as Omit<InventoryItemRecord, "createdAt" | "updatedAt" | "companyId">);

      return Response.json({ item: created }, { status: 201 });
    }

    case "PATCH": {
      if (!id) return jsonError("Method not allowed.", 405);
      const body = await readBody(request);
      if (body instanceof Response) return body;

      const serverOwned = rejectServerOwnedFields(body);
      if (serverOwned) {
        logTenantDenial(ctx, "inventory update carried server-owned fields", url.pathname);
        return serverOwned;
      }

      // Read before the role gate: the freeze check needs the stored status, and
      // a 404 for another company's SKU must not depend on the caller's role.
      const current = await items.get(ctx, id);
      if (!current) {
        logTenantDenial(ctx, "inventory update matched no record", url.pathname);
        return jsonError("Inventory item not found.", 404, "not_found");
      }

      const gate = denialResponse(checkInventoryItemUpdate(ctx, body, current));
      if (gate) {
        logTenantDenial(ctx, "role denied inventory update", url.pathname);
        return gate;
      }

      const coerced = coerceItemFields(body);
      if (!coerced.ok) return jsonError(coerced.message, 400, "invalid_payload");
      const fields = coerced.value;

      if (typeof fields.sku === "string" && fields.sku !== current.sku) {
        if (!fields.sku) return jsonError("sku cannot be empty.", 400, "invalid_payload");
        if (await skuIsTaken(ctx, fields.sku, id)) {
          return jsonError(`SKU ${fields.sku} already exists.`, 409, "duplicate_sku");
        }
      }
      if (fields.name !== undefined && !fields.name) {
        return jsonError("name cannot be empty.", 400, "invalid_payload");
      }

      const updated = await items.update(ctx, id, fields as Partial<InventoryItemRecord>);
      return Response.json({ item: updated });
    }

    case "DELETE": {
      if (!id) return jsonError("Method not allowed.", 405);

      const current = await items.get(ctx, id);
      if (!current) {
        logTenantDenial(ctx, "inventory delete matched no record", url.pathname);
        return jsonError("Inventory item not found.", 404, "not_found");
      }

      const gate = denialResponse(checkInventoryItemDelete(ctx, current));
      if (gate) {
        logTenantDenial(ctx, "role or stock denied inventory delete", url.pathname);
        return gate;
      }

      await items.remove(ctx, id);
      return new Response(null, { status: 204 });
    }

    default:
      return jsonError("Method not allowed.", 405);
  }
}

/* ------------------------------------------------------------------ *
 * Movements
 * ------------------------------------------------------------------ */

async function handleMovements(
  request: Request,
  url: URL,
  ctx: Awaited<ReturnType<typeof requireCurrentTenantContext>>,
  id: string | null,
): Promise<Response> {
  if (request.method === "GET") {
    if (id) {
      const record = await movements.get(ctx, id);
      if (!record) {
        logTenantDenial(ctx, "inventory movement not found or not in company", url.pathname);
        return jsonError("Inventory movement not found.", 404, "not_found");
      }
      return Response.json({ movement: record });
    }

    const all = await movements.list(ctx);
    // Filtering by item happens after the scoped query, not instead of it — the
    // query parameter narrows a result set the caller is already entitled to,
    // and is never an input to the authorization decision.
    const itemId = url.searchParams.get("itemId")?.trim();
    const reference = url.searchParams.get("reference")?.trim();
    const filtered = all.filter((row) => {
      if (itemId && row.itemId !== itemId) return false;
      if (reference && (row.reference ?? "").trim() !== reference) return false;
      return true;
    });
    // Newest first: a ledger is read from the end.
    filtered.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    return Response.json({ movements: filtered });
  }

  if (request.method !== "POST" || id) {
    return jsonError("Method not allowed.", 405);
  }

  const body = await readBody(request);
  if (body instanceof Response) return body;

  const serverOwned = rejectServerOwnedFields(body);
  if (serverOwned) {
    logTenantDenial(ctx, "movement carried server-owned fields", url.pathname);
    return serverOwned;
  }

  const itemId = typeof body.itemId === "string" ? body.itemId.trim() : "";
  if (!itemId) return jsonError("itemId is required.", 400, "invalid_payload");

  if (!isInventoryMovementKind(body.kind)) {
    return jsonError(
      `kind must be one of: ${INVENTORY_MOVEMENT_KINDS.join(", ")}.`,
      400,
      "invalid_payload",
    );
  }
  const kind = body.kind;

  const rawQuantity = typeof body.quantity === "string" ? Number(body.quantity) : body.quantity;
  if (typeof rawQuantity !== "number" || !Number.isFinite(rawQuantity)) {
    return jsonError("quantity must be a number.", 400, "invalid_payload");
  }

  const gate = denialResponse(checkInventoryMovement(ctx, kind));
  if (gate) {
    logTenantDenial(ctx, `role denied ${kind} movement`, url.pathname);
    return gate;
  }

  const text = (value: unknown, limit = MAX_SHORT_TEXT_LENGTH): string | undefined => {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    return trimmed.slice(0, limit);
  };

  const posted = await executePostedMovement(ctx, {
    itemId,
    kind,
    quantity: rawQuantity,
    reason: text(body.reason),
    reference: text(body.reference),
    notes: text(body.notes, MAX_TEXT_LENGTH),
  });
  if (!posted.ok) {
    if (posted.status === 404) {
      logTenantDenial(ctx, "movement targeted an item not in company", url.pathname);
    }
    return jsonError(posted.message, posted.status, posted.code);
  }
  return Response.json({ movement: posted.movement, item: posted.item }, { status: 201 });
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

export async function handleInventoryApiRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const route = parsePath(url);
  if (!route) return jsonError("Not found.", 404, "not_found");

  let ctx;
  try {
    ctx = await requireCurrentTenantContext(request);
  } catch (err) {
    return tenantErrorResponse(err) ?? jsonError("Sign in required.", 401, "not_authenticated");
  }

  const refused = refuseClientOnOpsApi(ctx, url.pathname);
  if (refused) return refused;

  // The admin console's per-user module matrix, enforced server-side. GET is a
  // view; everything else is a mutate. Layered *over* the role gates in
  // `inventory-permissions`, not instead of them — see `module-access`.
  const moduleGate = await checkModuleAccess(
    request,
    ctx,
    "Inventory",
    request.method === "GET" ? "view" : "mutate",
  );
  if (!moduleGate.ok) return moduleAccessResponse(moduleGate);

  try {
    return route.kind === "items"
      ? await handleItems(request, url, ctx, route.id)
      : await handleMovements(request, url, ctx, route.id);
  } catch (err) {
    // `requireCompanyId` throws from inside the repository, not from
    // `requireCurrentTenantContext` above — so the tenant errors have to be
    // mapped here too. Without this a caller with no company assignment gets
    // "Could not complete that request" instead of the 403 the client keys on to
    // show the company-assignment prompt.
    const tenantError = tenantErrorResponse(err);
    if (tenantError) return tenantError;

    if (err instanceof RecordAlreadyExistsError) {
      return jsonError(err.message, err.status, err.code);
    }
    if (err instanceof RecordPreconditionFailedError) {
      return jsonError(err.message, err.status, err.code);
    }
    if (err instanceof RecordNotFoundError) {
      logTenantDenial(ctx, "scoped inventory operation matched no record", url.pathname);
      return jsonError(err.message, err.status, err.code);
    }
    if (err instanceof ServerDataPrincipalMissingError) {
      console.error("[inventory] data principal is not configured");
      return jsonError("Server is not configured for data access.", 503, err.code);
    }
    // A missing table is a provisioning step, not a fault — say which one and
    // how to create it rather than answering with a bare 502. The names here are
    // our own configuration; nothing tenant-derived is disclosed.
    if ((err as { name?: string })?.name === "ResourceNotFoundException") {
      console.error("[inventory] table or index missing", itemsTable(), movementsTable());
      return jsonError(
        `Inventory storage is not provisioned. Create DynamoDB tables "${itemsTable()}" ` +
          `(partition key itemId) and "${movementsTable()}" (partition key movementId), each with ` +
          `a companyId-index GSI — see docs/inventory-module.md.`,
        503,
        "storage_not_provisioned",
      );
    }
    if ((err as { name?: string })?.name === "ValidationException") {
      console.error("[inventory] index missing or still building");
      return jsonError(
        "The inventory companyId-index is missing or still building. Check " +
          "scripts/check-company-indexes.mjs.",
        503,
        "index_not_ready",
      );
    }
    if ((err as { name?: string })?.name === "AccessDeniedException") {
      console.error("[inventory] server principal lacks inventory table access");
      return jsonError(
        "The server principal is not permitted on the inventory tables. Re-run " +
          "scripts/render-iam-policies.mjs and reapply the server policy.",
        503,
        "principal_not_permitted",
      );
    }
    // AWS messages carry table names and key values — the detail goes to the
    // log, the caller gets a status.
    console.error("[inventory] request failed", err instanceof Error ? err.message : err);
    return jsonError("Could not complete that request.", 502, "error");
  }
}
