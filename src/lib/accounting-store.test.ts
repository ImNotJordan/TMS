import { describe, expect, it } from "vitest";

import { buildDraftLinesFromLoad } from "./accounting-store";
import type { LoadRecord } from "./loads-store";

function load(overrides: Partial<LoadRecord> = {}): LoadRecord {
  return {
    loadId: "load-1",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    customerRate: "3000.00",
    ...overrides,
  } as LoadRecord;
}

describe("buildDraftLinesFromLoad — manual tax", () => {
  const taxLine = (record: LoadRecord) =>
    buildDraftLinesFromLoad(record).find((line) => line.id === "tax");

  it("adds no tax line when nobody recorded a figure", () => {
    expect(taxLine(load())).toBeUndefined();
  });

  it("carries a recorded figure onto the invoice with its provenance", () => {
    const line = taxLine(load({ taxManualAmount: "925.00" }));
    expect(line).toMatchObject({
      kind: "tax",
      label: "Tax",
      amount: 925,
      source: "derived",
      sourceField: "taxManualAmount",
    });
  });

  /**
   * The one place this deliberately departs from how accessorials behave.
   *
   * `push` drops zero-valued lines, which is right for a lumper fee that was
   * never charged. It is wrong for tax: "we checked, and it is zero" is a
   * meaningful statement on a freight invoice — and it is the *usual* answer for
   * US interstate, where the haul is not a taxable sale. Silently omitting the
   * line makes a deliberate zero indistinguishable from never having looked.
   */
  it("keeps an explicit zero, unlike an unbilled accessorial", () => {
    const lines = buildDraftLinesFromLoad(load({ taxManualAmount: "0", lumperFee: "0" }));
    expect(lines.find((line) => line.id === "tax")?.amount).toBe(0);
    expect(lines.some((line) => line.id === "lumper")).toBe(false);
  });

  it("rounds to the cent rather than carrying float noise", () => {
    expect(taxLine(load({ taxManualAmount: "185.005" }))?.amount).toBe(185.01);
  });

  it("ignores an unparseable entry instead of billing NaN", () => {
    for (const value of ["", "   ", "abc", "$-"]) {
      expect(taxLine(load({ taxManualAmount: value })), value).toBeUndefined();
    }
  });

  it("does not disturb the lines that were already there", () => {
    const without = buildDraftLinesFromLoad(load({ fuelSurcharge: "450.00" }));
    const with_ = buildDraftLinesFromLoad(load({ fuelSurcharge: "450.00", taxManualAmount: "12" }));
    expect(with_.slice(0, without.length)).toEqual(without);
    expect(with_).toHaveLength(without.length + 1);
  });

  /** Tax belongs last: it is charged on what precedes it. */
  it("sits after the charges it is levied on", () => {
    const lines = buildDraftLinesFromLoad(
      load({ fuelSurcharge: "450.00", detentionRate: "120.00", taxManualAmount: "50.00" }),
    );
    expect(lines[lines.length - 1]?.id).toBe("tax");
  });
});
