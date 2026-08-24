/**
 * Client transport for `/api/inventory`.
 *
 * Mirrors the other operational stores — same list-cache behaviour, same
 * `ResourceApiError` — with two deliberate differences that come from the
 * server's contract rather than from taste:
 *
 * 1. **Quantities are stripped from every item write.** The API refuses them
 *    (403 `ledger_owned_field`), on purpose, so an attempt is visible rather than
 *    silently dropped. But an edit dialog legitimately holds a whole record
 *    including its stock, and sending it back on save is the obvious thing to
 *    do, not an attack. So it is stripped here; the server's refusal stays as
 *    the backstop for anything that is not this client.
 *
 * 2. **`recordMovement` returns the item as well as the movement.** The server
 *    computed the new levels; re-deriving them here would be a second
 *    implementation of the stock arithmetic, and the two would drift.
 */
import {
  ResourceApiError,
  sendResourceRequest,
  createResourceClient,
} from "@/lib/api/resource-client";
import {
  fetchOperationalListCached,
  getOperationalCacheScope,
  removeOperationalListItem,
  upsertOperationalListItem,
  type OperationalListKind,
} from "@/lib/operational-data-cache";
import type {
  InventoryItemRecord,
  InventoryMovementKind,
  InventoryMovementRecord,
} from "@/lib/inventory-domain";

const ITEMS_KIND: OperationalListKind = "inventoryItems";
const MOVEMENTS_KIND: OperationalListKind = "inventoryMovements";

const getItemKey = (row: InventoryItemRecord) => row.itemId;
const getMovementKey = (row: InventoryMovementRecord) => row.movementId;

/**
 * `createResourceClient("inventory/items", …)` resolves to `/api/inventory/items`
 * and `/api/inventory/items/:id` — the same five operations, the same auth, the
 * same error mapping. Nothing about the nested path needs a second transport.
 */
const itemsApi = createResourceClient<InventoryItemRecord>("inventory/items", {
  collection: "items",
  item: "item",
});

/** Ledger-owned. Present on a record the UI is editing; never sent back. */
const LEDGER_OWNED_FIELDS = [
  "quantityOnHand",
  "quantityAllocated",
  "lastMovementAt",
  "lastCountedAt",
] as const;

export type InventoryItemInput = Partial<
  Omit<
    InventoryItemRecord,
    | "itemId"
    | "createdAt"
    | "updatedAt"
    | "companyId"
    | "createdBy"
    | (typeof LEDGER_OWNED_FIELDS)[number]
  >
> & { sku: string; name: string };

function withoutLedgerFields(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if ((LEDGER_OWNED_FIELDS as readonly string[]).includes(key)) continue;
    if (key === "itemId") continue;
    if (value === undefined) continue;
    out[key] = value;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Items
 * ------------------------------------------------------------------ */

export async function listInventoryItems(): Promise<InventoryItemRecord[]> {
  return itemsApi.list();
}

export async function listInventoryItemsCached(options?: {
  force?: boolean;
  scope?: string;
}): Promise<InventoryItemRecord[]> {
  return fetchOperationalListCached({
    kind: ITEMS_KIND,
    scope: options?.scope,
    force: options?.force,
    getId: getItemKey,
    fetchRemote: () => itemsApi.list(),
  });
}

export async function getInventoryItem(itemId: string): Promise<InventoryItemRecord | null> {
  return itemsApi.get(itemId);
}

export async function createInventoryItem(input: InventoryItemInput): Promise<InventoryItemRecord> {
  const created = await itemsApi.create(withoutLedgerFields(input as Record<string, unknown>));
  upsertOperationalListItem(ITEMS_KIND, getOperationalCacheScope(), created, getItemKey);
  return created;
}

export async function updateInventoryItem(
  itemId: string,
  patch: Partial<InventoryItemRecord>,
): Promise<InventoryItemRecord> {
  const updated = await itemsApi.update(
    itemId,
    withoutLedgerFields(patch as Record<string, unknown>),
  );
  upsertOperationalListItem(ITEMS_KIND, getOperationalCacheScope(), updated, getItemKey);
  return updated;
}

export async function deleteInventoryItem(itemId: string): Promise<void> {
  await itemsApi.remove(itemId);
  removeOperationalListItem(
    ITEMS_KIND,
    getOperationalCacheScope(),
    itemId,
    getItemKey as unknown as (row: { updatedAt: string }) => string,
  );
}

/* ------------------------------------------------------------------ *
 * Movements
 * ------------------------------------------------------------------ */

export type RecordMovementInput = {
  itemId: string;
  kind: InventoryMovementKind;
  quantity: number;
  reason?: string;
  reference?: string;
  notes?: string;
};

export type RecordMovementResult = {
  movement: InventoryMovementRecord;
  item: InventoryItemRecord;
};

export async function listInventoryMovements(options?: {
  itemId?: string;
}): Promise<InventoryMovementRecord[]> {
  const query = options?.itemId ? `?itemId=${encodeURIComponent(options.itemId)}` : "";
  const body = await sendResourceRequest<{ movements: InventoryMovementRecord[] }>(
    `/api/inventory/movements${query}`,
  );
  return body?.movements ?? [];
}

export async function listInventoryMovementsCached(options?: {
  force?: boolean;
  scope?: string;
}): Promise<InventoryMovementRecord[]> {
  return fetchOperationalListCached({
    kind: MOVEMENTS_KIND,
    scope: options?.scope,
    force: options?.force,
    getId: getMovementKey,
    fetchRemote: () => listInventoryMovements(),
  });
}

/**
 * Post a movement. The only way stock changes.
 *
 * A 409 means another movement landed between this client's read and its write —
 * the server refused rather than interleaving. One silent retry is honest here:
 * the caller's *intent* ("ship 8") is still valid against the newer levels, and
 * the server re-validates it against them. Beyond one retry the contention is
 * real and the user should see it, rather than the app spinning against a busy
 * SKU.
 */
export async function recordInventoryMovement(
  input: RecordMovementInput,
  options?: { retryOnConflict?: boolean },
): Promise<RecordMovementResult> {
  const retry = options?.retryOnConflict ?? true;

  const post = async (): Promise<RecordMovementResult> => {
    const body = await sendResourceRequest<RecordMovementResult>("/api/inventory/movements", {
      method: "POST",
      body: {
        itemId: input.itemId,
        kind: input.kind,
        quantity: input.quantity,
        ...(input.reason ? { reason: input.reason } : {}),
        ...(input.reference ? { reference: input.reference } : {}),
        ...(input.notes ? { notes: input.notes } : {}),
      },
    });
    if (!body?.movement || !body?.item) {
      throw new ResourceApiError("The movement did not return a result.", 502);
    }
    return body;
  };

  let result: RecordMovementResult;
  try {
    result = await post();
  } catch (err) {
    // Only a genuine concurrency conflict is retryable. The other 409 on this
    // endpoint — posting against an archived SKU — will fail identically forever,
    // so retrying it just doubles the round trip before the same error surfaces.
    const stale = err instanceof ResourceApiError && err.code === "STALE_RECORD";
    if (!stale || !retry) throw err;
    result = await post();
  }

  // Both caches move together — the ledger row and the stock level it produced
  // are one event, and showing one without the other is how a table appears to
  // contradict itself.
  const scope = getOperationalCacheScope();
  upsertOperationalListItem(ITEMS_KIND, scope, result.item, getItemKey);
  upsertOperationalListItem(MOVEMENTS_KIND, scope, result.movement, getMovementKey);
  return result;
}

export { ResourceApiError };
