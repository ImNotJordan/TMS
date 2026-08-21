import { describe, expect, it } from "vitest";

import { snapshotClientLoadTax } from "./client-dashboard-tax";

describe("snapshotClientLoadTax", () => {
  it("returns the amount Dynamo stored, including a Settings-backed estimator stamp", () => {
    const snap = snapshotClientLoadTax({
      customerRate: "2400",
      taxManualAmount: "113.09",
      taxCurrency: "USD",
      taxManualSource: "estimator",
      taxManualNote: "Settings rate applied at save.",
      pickupState: "HI",
      deliveryState: "HI",
    });
    expect(snap.source).toBe("estimate");
    expect(snap.amount).toBe(113.09);
    expect(snap.currency).toBe("USD");
    expect(snap.note).toBe("Settings rate applied at save.");
    expect(snap.lines).toEqual([
      expect.objectContaining({ amount: 113.09, currency: "USD", label: "US freight tax" }),
    ]);
  });

  it("prefers a typed override over anything the lane would estimate", () => {
    const snap = snapshotClientLoadTax({
      customerRate: "10000",
      taxManualAmount: "900",
      taxCurrency: "CNY",
      taxManualSource: "Special VAT invoice on file",
      taxManualNote: "Special VAT invoice on file",
      pickupState: "Guangdong",
      deliveryState: "Shanghai",
    });
    expect(snap.source).toBe("manual");
    expect(snap.amount).toBe(900);
    expect(snap.currency).toBe("CNY");
    expect(snap.note).toBe("Special VAT invoice on file");
  });

  it("does not re-estimate when nothing was stored — the load is the source of truth", () => {
    const snap = snapshotClientLoadTax({
      customerRate: "10000",
      pickupState: "TX",
      deliveryState: "CA",
    });
    expect(snap.amount).toBe(0);
    expect(snap.country).toBe("US");
    expect(snap.regime).toBe("us-no-vat");
    expect(snap.confidence).toBe("indeterminate");
  });

  it("does not invent a billed figure when the rate is missing", () => {
    const snap = snapshotClientLoadTax({ pickupState: "Texas", deliveryState: "Texas" });
    expect(snap.amount).toBe(0);
    expect(Number.isFinite(snap.amount)).toBe(true);
  });

  it("returns stored China VAT and US tax as separate lines on a transpacific load", () => {
    const snap = snapshotClientLoadTax({
      customerRate: "10000",
      taxManualAmount: "900.00",
      taxCurrency: "CNY",
      taxManualSource: "estimator",
      pickupState: "Shanghai",
      deliveryState: "CA",
      taxLines: [
        {
          country: "CN",
          label: "China VAT",
          amount: "900.00",
          currency: "CNY",
          note: "9% output VAT on the China origin charge",
        },
        {
          country: "US",
          label: "US freight tax",
          amount: "113.09",
          currency: "USD",
          note: "Settings rate on the US inland leg",
        },
      ],
    });
    expect(snap.lines).toHaveLength(2);
    expect(snap.lines[0]).toMatchObject({ label: "China VAT", amount: 900, currency: "CNY" });
    expect(snap.lines[1]).toMatchObject({ label: "US freight tax", amount: 113.09, currency: "USD" });
    expect(snap.label).toContain("China VAT");
    expect(snap.label).toContain("US freight tax");
  });
});
