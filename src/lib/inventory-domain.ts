/**
 * Inventory domain rules — pure, shared by the browser and the server.
 *
 * ## Why the stock math lives here rather than in the handler
 *
 * Every quantity in this module is decided by exactly one function,
 * `applyMovement`. The server calls it to authorize and compute a write; the
 * movement dialog calls it to preview the result before the user commits. One
 * implementation means the preview cannot promise something the server then
 * refuses, and the invariants below cannot be enforced in one place and
 * forgotten in the other.
 *
 * ## The invariants
 *
 * 1. `quantityOnHand >= 0` — you cannot ship stock you do not have.
 * 2. `quantityAllocated >= 0`.
 * 3. `quantityAllocated <= quantityOnHand` — you cannot promise more than you
 *    hold. This is the one that catches the interesting mistakes: adjusting
 *    stock down past what is already committed to a load, or allocating twice
 *    against the same pallet.
 *
 * DynamoDB condition expressions cannot express (3) — they have no arithmetic —
 * so it is checked here against the record read in the same request, and the
 * write carries an optimistic-concurrency precondition on both quantities. A
 * concurrent movement makes the write fail rather than interleave. See
 * `inventory-proxy`.
 *
 * ## Quantities are never mutated by an edit
 *
 * `quantityOnHand` and `quantityAllocated` are ledger-derived. Nothing may
 * assign them — not a create, not a patch, not an admin. They move only as the
 * arithmetic consequence of a posted movement, which is what makes the ledger
 * reconcile to the stock level instead of merely sitting alongside it.
 */

export const INVENTORY_ITEM_STATUSES = ["Active", "On Hold", "Discontinued", "Archived"] as const;
export type InventoryItemStatus = (typeof INVENTORY_ITEM_STATUSES)[number];

export const INVENTORY_UNITS_OF_MEASURE = [
  "Each",
  "Case",
  "Carton",
  "Pallet",
  "Drum",
  "Roll",
  "Bundle",
  "Pound",
  "Kilogram",
  "Gallon",
  "Liter",
] as const;
export type InventoryUnitOfMeasure = (typeof INVENTORY_UNITS_OF_MEASURE)[number];

export const INVENTORY_CATEGORIES = [
  "General Freight",
  "Consumer Goods",
  "Retail",
  "Industrial Parts",
  "Automotive",
  "Food & Beverage",
  "Refrigerated",
  "Hazmat",
  "Packaging & Supplies",
  "Equipment",
] as const;
export type InventoryCategory = (typeof INVENTORY_CATEGORIES)[number];

/**
 * The six things that can happen to stock.
 *
 * Split this finely on purpose. `receipt` and `shipment` are the operational
 * flow and belong to whoever works the dock. `adjustment` and `count` write off
 * value and reconcile against a physical truth, so they are gated to a narrower
 * set of roles — see `inventory-permissions`. Collapsing them into one "set the
 * quantity" verb is the version where shrink becomes invisible.
 */
export const INVENTORY_MOVEMENT_KINDS = [
  "receipt",
  "shipment",
  "adjustment",
  "count",
  "allocate",
  "release",
] as const;
export type InventoryMovementKind = (typeof INVENTORY_MOVEMENT_KINDS)[number];

export const INVENTORY_MOVEMENT_LABELS: Record<InventoryMovementKind, string> = {
  receipt: "Receipt",
  shipment: "Shipment",
  adjustment: "Adjustment",
  count: "Cycle count",
  allocate: "Allocation",
  release: "Release",
};

export const INVENTORY_MOVEMENT_DESCRIPTIONS: Record<InventoryMovementKind, string> = {
  receipt: "Stock arrived at the warehouse. Adds to on hand.",
  shipment: "Stock left on a load. Removes from on hand and frees any allocation it consumed.",
  adjustment: "Signed correction for damage, shrink, or a data fix. Writes off value.",
  count: "Physical count. Sets on hand to the counted total and records the variance.",
  allocate: "Commit available stock to a load or order. On hand is unchanged.",
  release: "Return committed stock to available. On hand is unchanged.",
};

/** A posted movement is settled. The other two states exist so a failed write is visible rather than lost. */
export const INVENTORY_MOVEMENT_STATES = ["pending", "posted", "rejected"] as const;
export type InventoryMovementState = (typeof INVENTORY_MOVEMENT_STATES)[number];

export type InventoryItemRecord = {
  /** Partition key. Server-generated — a client-chosen key is a collision the client controls. */
  itemId: string;
  sku: string;
  name: string;
  description?: string;
  category?: string;
  warehouse: string;
  binLocation?: string;
  unitOfMeasure: string;
  /** Ledger-derived. Never writable through an item create or patch. */
  quantityOnHand: number;
  /** Ledger-derived. Committed to a load or order but still physically present. */
  quantityAllocated: number;
  reorderPoint: number;
  reorderQuantity: number;
  /** Economic. Gated to the roles that may value stock. */
  unitCost: number;
  /** Economic. */
  unitPrice: number;
  supplierName?: string;
  supplierSku?: string;
  hazmat?: boolean;
  temperatureControlled?: boolean;
  temperatureRange?: string;
  weightPerUnitLb?: number;
  status: InventoryItemStatus;
  /** Set by a posted `count`. */
  lastCountedAt?: string;
  /** Set by any posted movement. */
  lastMovementAt?: string;
  notes?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  companyId?: string;
};

export type InventoryMovementRecord = {
  /** Partition key. Server-generated. */
  movementId: string;
  itemId: string;
  /**
   * Denormalized so the ledger stays readable after the item is renamed or
   * deleted. A ledger that needs a join to mean anything is not an audit trail.
   */
  sku: string;
  itemName?: string;
  kind: InventoryMovementKind;
  /**
   * What the caller asked for. Positive for every kind except `adjustment`,
   * which is signed; for `count` this is the counted total, not a delta.
   */
  quantity: number;
  onHandDelta: number;
  allocatedDelta: number;
  resultingOnHand: number;
  resultingAllocated: number;
  warehouse?: string;
  reason?: string;
  /** Load id, BOL, PO — whatever ties this movement to the thing that caused it. */
  reference?: string;
  notes?: string;
  postedState: InventoryMovementState;
  rejectedReason?: string;
  /** Role at the time of the movement, so a later role change cannot rewrite history. */
  actorRole?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  companyId?: string;
};

export type StockLevels = {
  quantityOnHand: number;
  quantityAllocated: number;
};

export type MovementIntent = {
  kind: InventoryMovementKind;
  quantity: number;
};

export type MovementEffect =
  | {
      ok: true;
      onHandDelta: number;
      allocatedDelta: number;
      next: StockLevels;
    }
  | {
      ok: false;
      code:
        | "invalid_quantity"
        | "insufficient_stock"
        | "insufficient_allocation"
        | "allocation_exceeds_stock"
        | "count_below_allocation"
        | "adjustment_below_allocation";
      message: string;
    };

/**
 * Largest quantity any single movement may carry.
 *
 * Not a business rule — a fat-finger guard. A receipt of 1e15 units is a typo
 * or a probe, and either way it should not become the stock level that every
 * later report is derived from.
 */
export const MAX_MOVEMENT_QUANTITY = 1_000_000_000;

/** Fractional units are real (kilograms, gallons), unbounded float drift is not. */
const QUANTITY_DECIMALS = 3;

export function roundQuantity(value: number): number {
  const factor = 10 ** QUANTITY_DECIMALS;
  return Math.round(value * factor) / factor;
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function isUsableNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function invalid(message: string): MovementEffect {
  return { ok: false, code: "invalid_quantity", message };
}

/**
 * The one place a stock quantity changes.
 *
 * Returns the deltas and the resulting levels, or a refusal naming the invariant
 * that would have been broken. Never throws, and never returns a state that
 * violates an invariant — callers may apply the result without re-checking.
 */
export function applyMovement(current: StockLevels, intent: MovementIntent): MovementEffect {
  const onHand = roundQuantity(isUsableNumber(current.quantityOnHand) ? current.quantityOnHand : 0);
  const allocated = roundQuantity(
    isUsableNumber(current.quantityAllocated) ? current.quantityAllocated : 0,
  );

  if (!isUsableNumber(intent.quantity)) {
    return invalid("Quantity must be a number.");
  }
  const quantity = roundQuantity(intent.quantity);
  if (Math.abs(quantity) > MAX_MOVEMENT_QUANTITY) {
    return invalid(
      `Quantity must be within ${MAX_MOVEMENT_QUANTITY.toLocaleString()} units of zero.`,
    );
  }

  switch (intent.kind) {
    case "receipt": {
      if (quantity <= 0) return invalid("A receipt must be a positive quantity.");
      return {
        ok: true,
        onHandDelta: quantity,
        allocatedDelta: 0,
        next: {
          quantityOnHand: roundQuantity(onHand + quantity),
          quantityAllocated: allocated,
        },
      };
    }

    case "shipment": {
      if (quantity <= 0) return invalid("A shipment must be a positive quantity.");
      if (quantity > onHand) {
        return {
          ok: false,
          code: "insufficient_stock",
          message: `Only ${onHand.toLocaleString()} on hand — cannot ship ${quantity.toLocaleString()}.`,
        };
      }
      // A shipment consumes allocation up to what it moves. Without the clamp an
      // unallocated shipment would drive `quantityAllocated` negative.
      const consumed = Math.min(quantity, allocated);
      return {
        ok: true,
        onHandDelta: -quantity,
        allocatedDelta: -consumed,
        next: {
          quantityOnHand: roundQuantity(onHand - quantity),
          quantityAllocated: roundQuantity(allocated - consumed),
        },
      };
    }

    case "adjustment": {
      if (quantity === 0) return invalid("An adjustment of zero changes nothing.");
      const nextOnHand = roundQuantity(onHand + quantity);
      if (nextOnHand < 0) {
        return {
          ok: false,
          code: "insufficient_stock",
          message: `That adjustment would leave ${nextOnHand.toLocaleString()} on hand.`,
        };
      }
      if (nextOnHand < allocated) {
        return {
          ok: false,
          code: "adjustment_below_allocation",
          message:
            `${allocated.toLocaleString()} units are committed to loads. Release allocations ` +
            `before adjusting on hand below that.`,
        };
      }
      return {
        ok: true,
        onHandDelta: quantity,
        allocatedDelta: 0,
        next: { quantityOnHand: nextOnHand, quantityAllocated: allocated },
      };
    }

    case "count": {
      if (quantity < 0) return invalid("A counted quantity cannot be negative.");
      if (quantity < allocated) {
        return {
          ok: false,
          code: "count_below_allocation",
          message:
            `The count is below the ${allocated.toLocaleString()} units committed to loads. ` +
            `Release those allocations first so the shortfall is attributed.`,
        };
      }
      return {
        ok: true,
        onHandDelta: roundQuantity(quantity - onHand),
        allocatedDelta: 0,
        next: { quantityOnHand: quantity, quantityAllocated: allocated },
      };
    }

    case "allocate": {
      if (quantity <= 0) return invalid("An allocation must be a positive quantity.");
      const nextAllocated = roundQuantity(allocated + quantity);
      if (nextAllocated > onHand) {
        return {
          ok: false,
          code: "allocation_exceeds_stock",
          message:
            `Only ${roundQuantity(onHand - allocated).toLocaleString()} available ` +
            `(${onHand.toLocaleString()} on hand, ${allocated.toLocaleString()} already committed).`,
        };
      }
      return {
        ok: true,
        onHandDelta: 0,
        allocatedDelta: quantity,
        next: { quantityOnHand: onHand, quantityAllocated: nextAllocated },
      };
    }

    case "release": {
      if (quantity <= 0) return invalid("A release must be a positive quantity.");
      if (quantity > allocated) {
        return {
          ok: false,
          code: "insufficient_allocation",
          message: `Only ${allocated.toLocaleString()} units are committed — cannot release ${quantity.toLocaleString()}.`,
        };
      }
      return {
        ok: true,
        onHandDelta: 0,
        allocatedDelta: -quantity,
        next: {
          quantityOnHand: onHand,
          quantityAllocated: roundQuantity(allocated - quantity),
        },
      };
    }

    default: {
      // Exhaustive over InventoryMovementKind; reachable only from an unvalidated
      // payload, which the handler rejects before it gets here.
      return invalid("Unknown movement type.");
    }
  }
}

export function isInventoryMovementKind(value: unknown): value is InventoryMovementKind {
  return (
    typeof value === "string" && (INVENTORY_MOVEMENT_KINDS as readonly string[]).includes(value)
  );
}

export function isInventoryItemStatus(value: unknown): value is InventoryItemStatus {
  return (
    typeof value === "string" && (INVENTORY_ITEM_STATUSES as readonly string[]).includes(value)
  );
}

/* ------------------------------------------------------------------ *
 * Derivations
 *
 * Available, value and stock health are computed, never stored. A stored
 * derived field is a second source of truth that drifts the first time a
 * write path forgets it.
 * ------------------------------------------------------------------ */

export function availableQuantity(item: Pick<InventoryItemRecord, keyof StockLevels>): number {
  return roundQuantity((item.quantityOnHand ?? 0) - (item.quantityAllocated ?? 0));
}

export function extendedCost(
  item: Pick<InventoryItemRecord, "quantityOnHand" | "unitCost">,
): number {
  return roundMoney((item.quantityOnHand ?? 0) * (item.unitCost ?? 0));
}

export function extendedRetail(
  item: Pick<InventoryItemRecord, "quantityOnHand" | "unitPrice">,
): number {
  return roundMoney((item.quantityOnHand ?? 0) * (item.unitPrice ?? 0));
}

export type StockHealth = "out" | "critical" | "low" | "healthy" | "overstock";

/**
 * Where this SKU sits against its own reorder point.
 *
 * Measured on *available* rather than on hand: stock already promised to a load
 * will not cover the next order, so counting it as coverage is how a warehouse
 * discovers a shortfall at the dock instead of on a report.
 *
 * An item with no reorder point has nothing to be low against, so it reports
 * healthy unless it is empty.
 */
export function stockHealth(
  item: Pick<InventoryItemRecord, "quantityOnHand" | "quantityAllocated" | "reorderPoint">,
): StockHealth {
  const available = availableQuantity(item);
  if (available <= 0) return "out";

  const reorderPoint = item.reorderPoint ?? 0;
  if (reorderPoint <= 0) return "healthy";

  if (available <= reorderPoint * 0.5) return "critical";
  if (available <= reorderPoint) return "low";
  if (available >= reorderPoint * 6) return "overstock";
  return "healthy";
}

export function isBelowReorder(
  item: Pick<InventoryItemRecord, "quantityOnHand" | "quantityAllocated" | "reorderPoint">,
): boolean {
  const health = stockHealth(item);
  return health === "out" || health === "critical" || health === "low";
}

/** Fill against the reorder point, 0–1, for the coverage bar. */
export function coverageRatio(
  item: Pick<InventoryItemRecord, "quantityOnHand" | "quantityAllocated" | "reorderPoint">,
): number {
  const reorderPoint = item.reorderPoint ?? 0;
  const available = Math.max(0, availableQuantity(item));
  if (reorderPoint <= 0) return available > 0 ? 1 : 0;
  return Math.min(1, available / (reorderPoint * 2));
}

export type InventorySummary = {
  skuCount: number;
  activeSkuCount: number;
  onHandUnits: number;
  allocatedUnits: number;
  availableUnits: number;
  costValue: number;
  retailValue: number;
  belowReorderCount: number;
  outOfStockCount: number;
  warehouseCount: number;
  hazmatSkuCount: number;
};

export function summarizeInventory(items: InventoryItemRecord[]): InventorySummary {
  const warehouses = new Set<string>();
  let onHandUnits = 0;
  let allocatedUnits = 0;
  let costValue = 0;
  let retailValue = 0;
  let belowReorderCount = 0;
  let outOfStockCount = 0;
  let activeSkuCount = 0;
  let hazmatSkuCount = 0;

  for (const item of items) {
    if (item.warehouse?.trim()) warehouses.add(item.warehouse.trim());
    onHandUnits += item.quantityOnHand ?? 0;
    allocatedUnits += item.quantityAllocated ?? 0;
    costValue += extendedCost(item);
    retailValue += extendedRetail(item);
    if (item.status === "Active") activeSkuCount += 1;
    if (item.hazmat) hazmatSkuCount += 1;

    const health = stockHealth(item);
    if (health === "out") outOfStockCount += 1;
    if (health === "out" || health === "critical" || health === "low") belowReorderCount += 1;
  }

  return {
    skuCount: items.length,
    activeSkuCount,
    onHandUnits: roundQuantity(onHandUnits),
    allocatedUnits: roundQuantity(allocatedUnits),
    availableUnits: roundQuantity(onHandUnits - allocatedUnits),
    costValue: roundMoney(costValue),
    retailValue: roundMoney(retailValue),
    belowReorderCount,
    outOfStockCount,
    warehouseCount: warehouses.size,
    hazmatSkuCount,
  };
}

export type WarehouseRollup = {
  warehouse: string;
  skuCount: number;
  onHandUnits: number;
  allocatedUnits: number;
  availableUnits: number;
  costValue: number;
  belowReorderCount: number;
};

/** Per-warehouse totals, busiest first. Locations are derived from the items, not a table of their own. */
export function rollupByWarehouse(items: InventoryItemRecord[]): WarehouseRollup[] {
  const byWarehouse = new Map<string, WarehouseRollup>();

  for (const item of items) {
    const warehouse = item.warehouse?.trim() || "Unassigned";
    const row =
      byWarehouse.get(warehouse) ??
      ({
        warehouse,
        skuCount: 0,
        onHandUnits: 0,
        allocatedUnits: 0,
        availableUnits: 0,
        costValue: 0,
        belowReorderCount: 0,
      } satisfies WarehouseRollup);

    row.skuCount += 1;
    row.onHandUnits += item.quantityOnHand ?? 0;
    row.allocatedUnits += item.quantityAllocated ?? 0;
    row.costValue += extendedCost(item);
    if (isBelowReorder(item)) row.belowReorderCount += 1;
    byWarehouse.set(warehouse, row);
  }

  return [...byWarehouse.values()]
    .map((row) => ({
      ...row,
      onHandUnits: roundQuantity(row.onHandUnits),
      allocatedUnits: roundQuantity(row.allocatedUnits),
      availableUnits: roundQuantity(row.onHandUnits - row.allocatedUnits),
      costValue: roundMoney(row.costValue),
    }))
    .sort((a, b) => b.costValue - a.costValue || b.onHandUnits - a.onHandUnits);
}

/** Units that moved in or out over the window, for the movement-velocity readout. */
export function movementTotals(
  movements: InventoryMovementRecord[],
  sinceIso?: string,
): { received: number; shipped: number; adjusted: number; counted: number; postedCount: number } {
  let received = 0;
  let shipped = 0;
  let adjusted = 0;
  let counted = 0;
  let postedCount = 0;

  for (const movement of movements) {
    if (movement.postedState !== "posted") continue;
    if (sinceIso && movement.createdAt < sinceIso) continue;
    postedCount += 1;
    if (movement.kind === "receipt") received += movement.onHandDelta;
    else if (movement.kind === "shipment") shipped += Math.abs(movement.onHandDelta);
    else if (movement.kind === "adjustment") adjusted += movement.onHandDelta;
    else if (movement.kind === "count") counted += 1;
  }

  return {
    received: roundQuantity(received),
    shipped: roundQuantity(shipped),
    adjusted: roundQuantity(adjusted),
    counted,
    postedCount,
  };
}
