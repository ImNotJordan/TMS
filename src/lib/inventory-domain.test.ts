import { describe, expect, it } from "vitest";

import {
  MAX_MOVEMENT_QUANTITY,
  applyMovement,
  availableQuantity,
  coverageRatio,
  extendedCost,
  isBelowReorder,
  movementTotals,
  rollupByWarehouse,
  stockHealth,
  summarizeInventory,
  type InventoryItemRecord,
  type InventoryMovementRecord,
} from "@/lib/inventory-domain";

function levels(onHand: number, allocated = 0) {
  return { quantityOnHand: onHand, quantityAllocated: allocated };
}

function item(overrides: Partial<InventoryItemRecord> = {}): InventoryItemRecord {
  return {
    itemId: overrides.itemId ?? "item-1",
    sku: overrides.sku ?? "SKU-1",
    name: overrides.name ?? "Test item",
    warehouse: overrides.warehouse ?? "Dallas DC",
    unitOfMeasure: overrides.unitOfMeasure ?? "Each",
    quantityOnHand: overrides.quantityOnHand ?? 0,
    quantityAllocated: overrides.quantityAllocated ?? 0,
    reorderPoint: overrides.reorderPoint ?? 0,
    reorderQuantity: overrides.reorderQuantity ?? 0,
    unitCost: overrides.unitCost ?? 0,
    unitPrice: overrides.unitPrice ?? 0,
    status: overrides.status ?? "Active",
    createdAt: overrides.createdAt ?? "2026-01-01T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function movement(overrides: Partial<InventoryMovementRecord> = {}): InventoryMovementRecord {
  return {
    movementId: overrides.movementId ?? "mv-1",
    itemId: overrides.itemId ?? "item-1",
    sku: overrides.sku ?? "SKU-1",
    kind: overrides.kind ?? "receipt",
    quantity: overrides.quantity ?? 10,
    onHandDelta: overrides.onHandDelta ?? 10,
    allocatedDelta: overrides.allocatedDelta ?? 0,
    resultingOnHand: overrides.resultingOnHand ?? 10,
    resultingAllocated: overrides.resultingAllocated ?? 0,
    postedState: overrides.postedState ?? "posted",
    createdAt: overrides.createdAt ?? "2026-01-10T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-01-10T00:00:00.000Z",
    ...overrides,
  };
}

describe("applyMovement — receipts", () => {
  it("adds to on hand and leaves allocation alone", () => {
    const effect = applyMovement(levels(10, 4), { kind: "receipt", quantity: 6 });
    expect(effect).toEqual({
      ok: true,
      onHandDelta: 6,
      allocatedDelta: 0,
      next: { quantityOnHand: 16, quantityAllocated: 4 },
    });
  });

  it("refuses a non-positive receipt", () => {
    expect(applyMovement(levels(0), { kind: "receipt", quantity: 0 }).ok).toBe(false);
    expect(applyMovement(levels(0), { kind: "receipt", quantity: -5 }).ok).toBe(false);
  });

  it("refuses an absurd quantity", () => {
    const effect = applyMovement(levels(0), {
      kind: "receipt",
      quantity: MAX_MOVEMENT_QUANTITY + 1,
    });
    expect(effect.ok).toBe(false);
  });
});

describe("applyMovement — shipments", () => {
  it("removes from on hand", () => {
    const effect = applyMovement(levels(10), { kind: "shipment", quantity: 4 });
    expect(effect.ok && effect.next).toEqual({ quantityOnHand: 6, quantityAllocated: 0 });
  });

  it("refuses shipping more than is on hand", () => {
    const effect = applyMovement(levels(3), { kind: "shipment", quantity: 4 });
    expect(effect.ok).toBe(false);
    expect(!effect.ok && effect.code).toBe("insufficient_stock");
  });

  it("shipping the whole shelf is allowed", () => {
    const effect = applyMovement(levels(4), { kind: "shipment", quantity: 4 });
    expect(effect.ok && effect.next.quantityOnHand).toBe(0);
  });

  /**
   * The clamp is the interesting part: without it an unallocated shipment drives
   * `quantityAllocated` negative, and the "allocated <= on hand" invariant then
   * holds only by accident.
   */
  it("consumes only as much allocation as it moves", () => {
    const effect = applyMovement(levels(10, 5), { kind: "shipment", quantity: 3 });
    expect(effect.ok && effect.next).toEqual({ quantityOnHand: 7, quantityAllocated: 2 });
  });

  it("never drives allocation negative when shipping unallocated stock", () => {
    const effect = applyMovement(levels(10, 2), { kind: "shipment", quantity: 8 });
    expect(effect.ok && effect.next).toEqual({ quantityOnHand: 2, quantityAllocated: 0 });
  });

  it("keeps allocated at or below on hand when shipping fully allocated stock", () => {
    const effect = applyMovement(levels(10, 10), { kind: "shipment", quantity: 3 });
    expect(effect.ok && effect.next).toEqual({ quantityOnHand: 7, quantityAllocated: 7 });
  });
});

describe("applyMovement — adjustments", () => {
  it("applies a signed delta", () => {
    expect(applyMovement(levels(10), { kind: "adjustment", quantity: -4 }).ok).toBe(true);
    const effect = applyMovement(levels(10), { kind: "adjustment", quantity: -4 });
    expect(effect.ok && effect.next.quantityOnHand).toBe(6);
  });

  it("refuses a zero adjustment", () => {
    expect(applyMovement(levels(10), { kind: "adjustment", quantity: 0 }).ok).toBe(false);
  });

  it("refuses driving on hand negative", () => {
    const effect = applyMovement(levels(3), { kind: "adjustment", quantity: -4 });
    expect(!effect.ok && effect.code).toBe("insufficient_stock");
  });

  it("refuses adjusting below what is already committed to loads", () => {
    const effect = applyMovement(levels(10, 8), { kind: "adjustment", quantity: -5 });
    expect(!effect.ok && effect.code).toBe("adjustment_below_allocation");
  });

  it("allows adjusting down to exactly the allocated level", () => {
    const effect = applyMovement(levels(10, 8), { kind: "adjustment", quantity: -2 });
    expect(effect.ok && effect.next).toEqual({ quantityOnHand: 8, quantityAllocated: 8 });
  });
});

describe("applyMovement — cycle counts", () => {
  it("sets on hand to the counted total and records the variance", () => {
    const effect = applyMovement(levels(10), { kind: "count", quantity: 7 });
    expect(effect.ok && effect.onHandDelta).toBe(-3);
    expect(effect.ok && effect.next.quantityOnHand).toBe(7);
  });

  it("a count matching the book is a zero-delta movement, not a refusal", () => {
    const effect = applyMovement(levels(10), { kind: "count", quantity: 10 });
    expect(effect.ok && effect.onHandDelta).toBe(0);
  });

  it("counting to zero is allowed when nothing is committed", () => {
    expect(applyMovement(levels(10), { kind: "count", quantity: 0 }).ok).toBe(true);
  });

  it("refuses a count below the committed quantity", () => {
    const effect = applyMovement(levels(10, 6), { kind: "count", quantity: 4 });
    expect(!effect.ok && effect.code).toBe("count_below_allocation");
  });

  it("refuses a negative count", () => {
    expect(applyMovement(levels(10), { kind: "count", quantity: -1 }).ok).toBe(false);
  });
});

describe("applyMovement — allocations", () => {
  it("commits available stock without touching on hand", () => {
    const effect = applyMovement(levels(10, 2), { kind: "allocate", quantity: 5 });
    expect(effect.ok && effect.next).toEqual({ quantityOnHand: 10, quantityAllocated: 7 });
    expect(effect.ok && effect.onHandDelta).toBe(0);
  });

  it("refuses committing more than is available", () => {
    const effect = applyMovement(levels(10, 8), { kind: "allocate", quantity: 3 });
    expect(!effect.ok && effect.code).toBe("allocation_exceeds_stock");
  });

  it("allows committing exactly the remainder", () => {
    const effect = applyMovement(levels(10, 8), { kind: "allocate", quantity: 2 });
    expect(effect.ok && effect.next.quantityAllocated).toBe(10);
  });

  it("releases back to available", () => {
    const effect = applyMovement(levels(10, 6), { kind: "release", quantity: 4 });
    expect(effect.ok && effect.next.quantityAllocated).toBe(2);
  });

  it("refuses releasing more than is committed", () => {
    const effect = applyMovement(levels(10, 2), { kind: "release", quantity: 3 });
    expect(!effect.ok && effect.code).toBe("insufficient_allocation");
  });
});

describe("applyMovement — arithmetic hygiene", () => {
  it("keeps fractional units clean", () => {
    const effect = applyMovement(levels(0.1), { kind: "receipt", quantity: 0.2 });
    expect(effect.ok && effect.next.quantityOnHand).toBe(0.3);
  });

  it("treats a missing level as zero rather than NaN", () => {
    const effect = applyMovement(
      { quantityOnHand: undefined as unknown as number, quantityAllocated: 0 },
      { kind: "receipt", quantity: 5 },
    );
    expect(effect.ok && effect.next.quantityOnHand).toBe(5);
  });

  it("refuses a non-numeric quantity", () => {
    const effect = applyMovement(levels(5), {
      kind: "receipt",
      quantity: Number.NaN,
    });
    expect(effect.ok).toBe(false);
  });

  it("never returns a state that breaks an invariant", () => {
    const kinds = ["receipt", "shipment", "adjustment", "count", "allocate", "release"] as const;
    for (const kind of kinds) {
      for (const quantity of [-7, -1, 0, 1, 3, 12]) {
        for (const [onHand, allocated] of [
          [0, 0],
          [5, 0],
          [10, 4],
          [10, 10],
        ]) {
          const effect = applyMovement(levels(onHand, allocated), { kind, quantity });
          if (!effect.ok) continue;
          expect(effect.next.quantityOnHand).toBeGreaterThanOrEqual(0);
          expect(effect.next.quantityAllocated).toBeGreaterThanOrEqual(0);
          expect(effect.next.quantityAllocated).toBeLessThanOrEqual(effect.next.quantityOnHand);
        }
      }
    }
  });
});

describe("derivations", () => {
  it("available subtracts allocations", () => {
    expect(availableQuantity(item({ quantityOnHand: 10, quantityAllocated: 4 }))).toBe(6);
  });

  it("stock health is measured on available, not on hand", () => {
    // Plenty on the shelf, all of it promised — that is a problem, not health.
    const promised = item({ quantityOnHand: 100, quantityAllocated: 100, reorderPoint: 10 });
    expect(stockHealth(promised)).toBe("out");
  });

  it("grades against the reorder point", () => {
    expect(stockHealth(item({ quantityOnHand: 0, reorderPoint: 10 }))).toBe("out");
    expect(stockHealth(item({ quantityOnHand: 4, reorderPoint: 10 }))).toBe("critical");
    expect(stockHealth(item({ quantityOnHand: 9, reorderPoint: 10 }))).toBe("low");
    expect(stockHealth(item({ quantityOnHand: 30, reorderPoint: 10 }))).toBe("healthy");
    expect(stockHealth(item({ quantityOnHand: 60, reorderPoint: 10 }))).toBe("overstock");
  });

  it("an item with no reorder point is healthy while it has stock", () => {
    expect(stockHealth(item({ quantityOnHand: 1, reorderPoint: 0 }))).toBe("healthy");
    expect(stockHealth(item({ quantityOnHand: 0, reorderPoint: 0 }))).toBe("out");
  });

  it("isBelowReorder covers out, critical and low", () => {
    expect(isBelowReorder(item({ quantityOnHand: 0, reorderPoint: 5 }))).toBe(true);
    expect(isBelowReorder(item({ quantityOnHand: 5, reorderPoint: 5 }))).toBe(true);
    expect(isBelowReorder(item({ quantityOnHand: 50, reorderPoint: 5 }))).toBe(false);
  });

  it("coverage ratio stays within 0..1", () => {
    expect(coverageRatio(item({ quantityOnHand: 0, reorderPoint: 10 }))).toBe(0);
    expect(coverageRatio(item({ quantityOnHand: 10, reorderPoint: 10 }))).toBe(0.5);
    expect(coverageRatio(item({ quantityOnHand: 900, reorderPoint: 10 }))).toBe(1);
  });

  it("extended cost rounds to cents rather than accumulating float dust", () => {
    // 3 × 1.1 is 3.3000000000000003 in IEEE 754. Unrounded, that value sums
    // across a catalogue into a valuation that is off by fractions of a cent and
    // never ties out against the ledger.
    expect(extendedCost(item({ quantityOnHand: 3, unitCost: 1.1 }))).toBe(3.3);
    expect(extendedCost(item({ quantityOnHand: 7, unitCost: 0.145 }))).toBe(1.01);
  });
});

describe("summarizeInventory", () => {
  it("totals units, value and exceptions", () => {
    const summary = summarizeInventory([
      item({ itemId: "a", quantityOnHand: 10, quantityAllocated: 4, unitCost: 2, unitPrice: 5 }),
      item({
        itemId: "b",
        warehouse: "Reno DC",
        quantityOnHand: 0,
        reorderPoint: 5,
        status: "On Hold",
      }),
      item({ itemId: "c", quantityOnHand: 6, reorderPoint: 10, unitCost: 1, hazmat: true }),
    ]);

    expect(summary.skuCount).toBe(3);
    expect(summary.activeSkuCount).toBe(2);
    expect(summary.onHandUnits).toBe(16);
    expect(summary.allocatedUnits).toBe(4);
    expect(summary.availableUnits).toBe(12);
    expect(summary.costValue).toBe(26);
    expect(summary.retailValue).toBe(50);
    expect(summary.outOfStockCount).toBe(1);
    expect(summary.belowReorderCount).toBe(2);
    expect(summary.warehouseCount).toBe(2);
    expect(summary.hazmatSkuCount).toBe(1);
  });

  it("handles an empty catalogue", () => {
    const summary = summarizeInventory([]);
    expect(summary.skuCount).toBe(0);
    expect(summary.costValue).toBe(0);
    expect(summary.warehouseCount).toBe(0);
  });
});

describe("rollupByWarehouse", () => {
  it("groups by location and buckets blanks as Unassigned", () => {
    const rows = rollupByWarehouse([
      item({ itemId: "a", warehouse: "Dallas DC", quantityOnHand: 10, unitCost: 3 }),
      item({ itemId: "b", warehouse: "Dallas DC", quantityOnHand: 5, unitCost: 1 }),
      item({ itemId: "c", warehouse: "   ", quantityOnHand: 2, unitCost: 1 }),
    ]);

    expect(rows).toHaveLength(2);
    const dallas = rows.find((row) => row.warehouse === "Dallas DC");
    expect(dallas?.skuCount).toBe(2);
    expect(dallas?.onHandUnits).toBe(15);
    expect(dallas?.costValue).toBe(35);
    expect(rows.some((row) => row.warehouse === "Unassigned")).toBe(true);
  });

  it("orders by value so the biggest location leads", () => {
    const rows = rollupByWarehouse([
      item({ itemId: "a", warehouse: "Small", quantityOnHand: 1, unitCost: 1 }),
      item({ itemId: "b", warehouse: "Big", quantityOnHand: 100, unitCost: 10 }),
    ]);
    expect(rows[0]?.warehouse).toBe("Big");
  });
});

describe("movementTotals", () => {
  it("counts only settled movements", () => {
    const totals = movementTotals([
      movement({ movementId: "1", kind: "receipt", onHandDelta: 10 }),
      movement({ movementId: "2", kind: "shipment", onHandDelta: -4 }),
      movement({ movementId: "3", kind: "receipt", onHandDelta: 99, postedState: "pending" }),
      movement({ movementId: "4", kind: "receipt", onHandDelta: 99, postedState: "rejected" }),
    ]);

    expect(totals.received).toBe(10);
    expect(totals.shipped).toBe(4);
    expect(totals.postedCount).toBe(2);
  });

  it("respects the window", () => {
    const totals = movementTotals(
      [
        movement({ movementId: "old", createdAt: "2025-01-01T00:00:00.000Z", onHandDelta: 50 }),
        movement({ movementId: "new", createdAt: "2026-06-01T00:00:00.000Z", onHandDelta: 7 }),
      ],
      "2026-01-01T00:00:00.000Z",
    );
    expect(totals.received).toBe(7);
  });
});
