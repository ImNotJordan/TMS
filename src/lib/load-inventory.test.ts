import { describe, expect, it } from "vitest";

import type { InventoryMovementRecord } from "@/lib/inventory-domain";

import {
  inventoryModeForStatus,
  parseLoadInventoryLines,
  planLoadInventoryMovements,
  positionByItemForLoad,
  summarizeLoadInventoryLines,
} from "./load-inventory";

function movement(
  over: Partial<InventoryMovementRecord> &
    Pick<InventoryMovementRecord, "itemId" | "kind" | "quantity">,
): InventoryMovementRecord {
  return {
    movementId: over.movementId ?? "m1",
    sku: over.sku ?? "SKU",
    createdAt: over.createdAt ?? "2026-08-20T00:00:00.000Z",
    updatedAt: over.updatedAt ?? "2026-08-20T00:00:00.000Z",
    postedState: over.postedState ?? "posted",
    onHandDelta: over.onHandDelta ?? 0,
    allocatedDelta: over.allocatedDelta ?? 0,
    resultingOnHand: over.resultingOnHand ?? 0,
    resultingAllocated: over.resultingAllocated ?? 0,
    reference: over.reference ?? "L-1",
    ...over,
  };
}

describe("inventoryModeForStatus", () => {
  it("reserves stock until the freight is on the trailer", () => {
    expect(inventoryModeForStatus("booked")).toBe("allocate");
    expect(inventoryModeForStatus("dispatched")).toBe("allocate");
    expect(inventoryModeForStatus("at-pickup")).toBe("allocate");
  });

  it("ships once the freight has left the dock", () => {
    expect(inventoryModeForStatus("loaded")).toBe("ship");
    expect(inventoryModeForStatus("in-transit")).toBe("ship");
    expect(inventoryModeForStatus("delivered")).toBe("ship");
  });

  it("gives the reservation back on cancel", () => {
    expect(inventoryModeForStatus("cancelled")).toBe("release");
    expect(inventoryModeForStatus("canceled")).toBe("release");
  });
});

describe("positionByItemForLoad", () => {
  it("nets allocate, ship and release against one load", () => {
    const pos = positionByItemForLoad(
      [
        movement({
          itemId: "i1",
          kind: "allocate",
          quantity: 10,
          createdAt: "2026-08-20T01:00:00.000Z",
        }),
        movement({
          itemId: "i1",
          kind: "shipment",
          quantity: 4,
          createdAt: "2026-08-20T02:00:00.000Z",
        }),
        movement({
          itemId: "i1",
          kind: "release",
          quantity: 1,
          createdAt: "2026-08-20T03:00:00.000Z",
        }),
        movement({
          itemId: "i1",
          kind: "allocate",
          quantity: 8,
          reference: "L-OTHER",
          createdAt: "2026-08-20T04:00:00.000Z",
        }),
      ],
      "L-1",
    );
    expect(pos.get("i1")).toEqual({ itemId: "i1", allocated: 5, shipped: 4 });
  });
});

describe("planLoadInventoryMovements", () => {
  const line = {
    lineId: "a",
    itemId: "i1",
    sku: "SKU-1",
    itemName: "Widgets",
    quantity: 10,
  };

  it("allocates the full line on a booked load with no history", () => {
    const plan = planLoadInventoryMovements({
      loadId: "L-1",
      status: "booked",
      lines: [line],
      movements: [],
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.movements).toEqual([
      {
        itemId: "i1",
        kind: "allocate",
        quantity: 10,
        reason: "Reserved for load L-1",
        reference: "L-1",
      },
    ]);
  });

  it("releases leftover reservation when the load is cancelled", () => {
    const plan = planLoadInventoryMovements({
      loadId: "L-1",
      status: "cancelled",
      lines: [line],
      movements: [
        movement({ itemId: "i1", kind: "allocate", quantity: 10, createdAt: "2026-08-20T01:00:00.000Z" }),
      ],
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.movements).toEqual([
      {
        itemId: "i1",
        kind: "release",
        quantity: 10,
        reason: "Released from load L-1",
        reference: "L-1",
      },
    ]);
  });

  it("ships the reservation when the load goes in transit", () => {
    const plan = planLoadInventoryMovements({
      loadId: "L-1",
      status: "in-transit",
      lines: [line],
      movements: [
        movement({ itemId: "i1", kind: "allocate", quantity: 10, createdAt: "2026-08-20T01:00:00.000Z" }),
      ],
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.movements.map((m) => `${m.kind}:${m.quantity}`)).toEqual(["shipment:10"]);
  });

  it("refuses to cut a line below what already shipped", () => {
    const plan = planLoadInventoryMovements({
      loadId: "L-1",
      status: "in-transit",
      lines: [{ ...line, quantity: 2 }],
      movements: [
        movement({ itemId: "i1", kind: "allocate", quantity: 10, createdAt: "2026-08-20T01:00:00.000Z" }),
        movement({ itemId: "i1", kind: "shipment", quantity: 10, createdAt: "2026-08-20T02:00:00.000Z" }),
      ],
    });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.code).toBe("below_shipped");
  });

  it("is a no-op when the ledger already matches", () => {
    const plan = planLoadInventoryMovements({
      loadId: "L-1",
      status: "booked",
      lines: [line],
      movements: [
        movement({ itemId: "i1", kind: "allocate", quantity: 10, createdAt: "2026-08-20T01:00:00.000Z" }),
      ],
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.movements).toEqual([]);
  });

  it("does not unwind a dock allocation when the load still has no freight lines", () => {
    const plan = planLoadInventoryMovements({
      loadId: "L-1",
      status: "booked",
      lines: [],
      previousLines: [],
      movements: [
        movement({ itemId: "i1", kind: "allocate", quantity: 10, createdAt: "2026-08-20T01:00:00.000Z" }),
      ],
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.movements).toEqual([]);
  });
});

describe("parseLoadInventoryLines", () => {
  it("drops rows without an item or a positive quantity", () => {
    expect(
      parseLoadInventoryLines([
        { itemId: "i1", sku: "A", itemName: "A", quantity: 2 },
        { itemId: "", sku: "B", quantity: 3 },
        { itemId: "i2", quantity: 0 },
      ]),
    ).toEqual([
      expect.objectContaining({ itemId: "i1", quantity: 2, sku: "A" }),
    ]);
  });
});

describe("summarizeLoadInventoryLines", () => {
  it("rolls SKUs and weight into the freight description", () => {
    const summary = summarizeLoadInventoryLines([
      {
        lineId: "1",
        itemId: "i1",
        sku: "BEV-24",
        itemName: "Cased beverages",
        quantity: 24,
        weightPerUnitLb: 40,
      },
    ]);
    expect(summary.text).toContain("24 × BEV-24");
    expect(summary.weightLb).toBe(960);
    expect(summary.pieces).toBe(24);
  });
});
