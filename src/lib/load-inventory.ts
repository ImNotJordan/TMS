/**
 * How a load and the warehouse talk to each other.
 *
 * McLeod-style: the load names the SKUs and quantities that will move; the
 * inventory ledger is the only thing that changes stock. This module is the
 * translation between those two records. It is pure so the create-load form,
 * the load API, and the driver pickup path all plan the same movements.
 *
 *   booked / dispatched  → allocate (commit warehouse stock to the load)
 *   loaded / in-transit  → shipment (stock left the building on this load)
 *   cancelled            → release  (give the reservation back)
 *
 * Quantities already shipped are never reversed here. A return is a `receipt`,
 * posted on purpose, not an edit of history.
 */
import { normalizeLoadStatus } from "@/lib/load-status";
import {
  roundQuantity,
  type InventoryMovementKind,
  type InventoryMovementRecord,
} from "@/lib/inventory-domain";

export type LoadInventoryLine = {
  lineId: string;
  itemId: string;
  sku: string;
  itemName: string;
  warehouse?: string;
  unitOfMeasure?: string;
  quantity: number;
  weightPerUnitLb?: number;
};

export type LoadInventoryMode = "allocate" | "ship" | "release";

export type LoadItemPosition = {
  itemId: string;
  /** Still reserved on this load, sitting in the warehouse. */
  allocated: number;
  /** Already shipped against this load. */
  shipped: number;
};

export type PlannedLoadMovement = {
  itemId: string;
  kind: Extract<InventoryMovementKind, "allocate" | "release" | "shipment">;
  quantity: number;
  reason: string;
  reference: string;
};

export type LoadInventoryPlan =
  | { ok: true; movements: PlannedLoadMovement[] }
  | { ok: false; message: string; code: "below_shipped" | "invalid_line" };

const MAX_LINES = 40;

/**
 * Warehouse posture this load's status implies.
 *
 * Pickup-adjacent statuses keep the reservation: the freight is still at the
 * shipper. Once it is on the trailer (`loaded` and after), it has shipped.
 */
export function inventoryModeForStatus(status: string | null | undefined): LoadInventoryMode {
  const canonical = normalizeLoadStatus(status);
  if (!canonical) return "allocate";
  if (canonical === "cancelled") return "release";
  if (
    canonical === "loaded" ||
    canonical === "in-transit" ||
    canonical === "at-delivery" ||
    canonical === "delivered" ||
    canonical === "pod-uploaded" ||
    canonical === "completed"
  ) {
    return "ship";
  }
  return "allocate";
}

export function parseLoadInventoryLines(raw: unknown): LoadInventoryLine[] {
  if (!Array.isArray(raw)) return [];
  const out: LoadInventoryLine[] = [];
  for (const row of raw.slice(0, MAX_LINES)) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const rec = row as Record<string, unknown>;
    const itemId = typeof rec.itemId === "string" ? rec.itemId.trim() : "";
    const sku = typeof rec.sku === "string" ? rec.sku.trim() : "";
    const itemName = typeof rec.itemName === "string" ? rec.itemName.trim() : "";
    const quantity = Number(rec.quantity);
    if (!itemId || !Number.isFinite(quantity) || quantity <= 0) continue;
    out.push({
      lineId:
        typeof rec.lineId === "string" && rec.lineId.trim()
          ? rec.lineId.trim()
          : `line-${out.length + 1}`,
      itemId,
      sku: sku || itemId,
      itemName: itemName || sku || itemId,
      warehouse: typeof rec.warehouse === "string" ? rec.warehouse.trim() || undefined : undefined,
      unitOfMeasure:
        typeof rec.unitOfMeasure === "string" ? rec.unitOfMeasure.trim() || undefined : undefined,
      quantity: roundQuantity(quantity),
      weightPerUnitLb:
        typeof rec.weightPerUnitLb === "number" && Number.isFinite(rec.weightPerUnitLb)
          ? rec.weightPerUnitLb
          : undefined,
    });
  }
  return out;
}

export function desiredQuantityByItem(lines: LoadInventoryLine[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const line of lines) {
    map.set(line.itemId, roundQuantity((map.get(line.itemId) ?? 0) + line.quantity));
  }
  return map;
}

export function positionByItemForLoad(
  movements: InventoryMovementRecord[],
  loadId: string,
): Map<string, LoadItemPosition> {
  const map = new Map<string, LoadItemPosition>();
  const rows = movements
    .filter(
      (row) => row.postedState === "posted" && (row.reference ?? "").trim() === loadId.trim(),
    )
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  for (const movement of rows) {
    const cur = map.get(movement.itemId) ?? {
      itemId: movement.itemId,
      allocated: 0,
      shipped: 0,
    };
    if (movement.kind === "allocate") {
      cur.allocated = roundQuantity(cur.allocated + movement.quantity);
    } else if (movement.kind === "release") {
      cur.allocated = roundQuantity(Math.max(0, cur.allocated - movement.quantity));
    } else if (movement.kind === "shipment") {
      const consume = Math.min(movement.quantity, cur.allocated);
      cur.allocated = roundQuantity(cur.allocated - consume);
      cur.shipped = roundQuantity(cur.shipped + movement.quantity);
    }
    map.set(movement.itemId, cur);
  }
  return map;
}

function pushMovement(
  out: PlannedLoadMovement[],
  loadId: string,
  itemId: string,
  kind: PlannedLoadMovement["kind"],
  quantity: number,
) {
  const qty = roundQuantity(quantity);
  if (qty <= 0) return;
  const reason =
    kind === "allocate"
      ? `Reserved for load ${loadId}`
      : kind === "release"
        ? `Released from load ${loadId}`
        : `Shipped on load ${loadId}`;
  out.push({ itemId, kind, quantity: qty, reason, reference: loadId });
}

/**
 * The movements that would make the ledger match this load's lines and status.
 *
 * Empty result means the warehouse is already in the right posture — a notes
 * edit on a load must not post a no-op receipt.
 */
export function planLoadInventoryMovements(input: {
  loadId: string;
  status: string | null | undefined;
  lines: LoadInventoryLine[];
  movements: InventoryMovementRecord[];
  /** Lines stored before this write. Empty-on-empty must not unwind a dock allocation. */
  previousLines?: LoadInventoryLine[];
}): LoadInventoryPlan {
  const loadId = input.loadId.trim();
  if (!loadId) {
    return { ok: false, code: "invalid_line", message: "A load id is required to move stock." };
  }

  const mode = inventoryModeForStatus(input.status);
  const desired = desiredQuantityByItem(input.lines);
  const previousDesired = desiredQuantityByItem(input.previousLines ?? []);
  const positions = positionByItemForLoad(input.movements, loadId);

  // A booked load with no freight lines is not "zero SKUs" — it is a load that
  // is not managing warehouse stock. Releasing on every notes save would drop
  // reservations posted from the inventory page with this load as the reference.
  if (desired.size === 0 && previousDesired.size === 0 && mode === "allocate") {
    return { ok: true, movements: [] };
  }
  const itemIds = new Set([...desired.keys(), ...positions.keys()]);
  const planned: PlannedLoadMovement[] = [];

  for (const itemId of itemIds) {
    const want = desired.get(itemId) ?? 0;
    const pos = positions.get(itemId) ?? { itemId, allocated: 0, shipped: 0 };

    if (want + 1e-9 < pos.shipped) {
      return {
        ok: false,
        code: "below_shipped",
        message:
          `Cannot drop ${itemId} below ${pos.shipped.toLocaleString()} units already shipped ` +
          `on ${loadId}. Post a warehouse receipt if freight is coming back.`,
      };
    }

    if (mode === "release") {
      pushMovement(planned, loadId, itemId, "release", pos.allocated);
      continue;
    }

    if (mode === "allocate") {
      const targetAlloc = roundQuantity(Math.max(0, want - pos.shipped));
      const delta = roundQuantity(targetAlloc - pos.allocated);
      if (delta > 0) pushMovement(planned, loadId, itemId, "allocate", delta);
      else if (delta < 0) pushMovement(planned, loadId, itemId, "release", -delta);
      continue;
    }

    // ship: everything still reserved, plus any extra the line now asks for
    const stillToShip = roundQuantity(Math.max(0, want - pos.shipped));
    if (pos.allocated > 0) {
      const shipFromAlloc = roundQuantity(Math.min(pos.allocated, stillToShip));
      pushMovement(planned, loadId, itemId, "shipment", shipFromAlloc);
      const leftoverAlloc = roundQuantity(pos.allocated - shipFromAlloc);
      if (leftoverAlloc > 0) pushMovement(planned, loadId, itemId, "release", leftoverAlloc);
      const extra = roundQuantity(stillToShip - shipFromAlloc);
      if (extra > 0) pushMovement(planned, loadId, itemId, "shipment", extra);
    } else if (stillToShip > 0) {
      pushMovement(planned, loadId, itemId, "shipment", stillToShip);
    }
  }

  return { ok: true, movements: planned };
}

export function summarizeLoadInventoryLines(lines: LoadInventoryLine[]): {
  text: string;
  weightLb: number;
  pieces: number;
} {
  if (lines.length === 0) return { text: "", weightLb: 0, pieces: 0 };
  const text = lines
    .map((line) => `${line.quantity} × ${line.sku}${line.itemName ? ` ${line.itemName}` : ""}`)
    .join("; ");
  const weightLb = lines.reduce(
    (sum, line) => sum + line.quantity * (line.weightPerUnitLb ?? 0),
    0,
  );
  const pieces = lines.reduce((sum, line) => sum + line.quantity, 0);
  return { text, weightLb: roundQuantity(weightLb), pieces: roundQuantity(pieces) };
}

export function newLoadInventoryLineId(): string {
  return `il-${crypto.randomUUID()}`;
}

/**
 * Load ids that still have warehouse stock reserved, keyed by SKU.
 *
 * The inventory page uses this to jump from an allocated row to the load that
 * is holding it — the McLeod "where is this committed" question.
 */
export function reservedLoadIdsByItem(
  movements: InventoryMovementRecord[],
): Map<string, string[]> {
  const loadIds = new Set(
    movements.map((row) => (row.reference ?? "").trim()).filter(Boolean),
  );
  const out = new Map<string, string[]>();
  for (const loadId of loadIds) {
    const positions = positionByItemForLoad(movements, loadId);
    for (const pos of positions.values()) {
      if (pos.allocated <= 0) continue;
      const existing = out.get(pos.itemId) ?? [];
      if (!existing.includes(loadId)) existing.push(loadId);
      out.set(pos.itemId, existing);
    }
  }
  return out;
}
