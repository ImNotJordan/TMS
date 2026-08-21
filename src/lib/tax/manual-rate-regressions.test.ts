/**
 * Bugs found by probing the manual-rate feature after it was built, kept as
 * tests so they cannot come back.
 *
 * All four came from the same root cause: the manual-rate work made a dormant
 * code path live. `salesTax` in the US branch had been hardcoded to zero since
 * the estimator was written, so nothing downstream of it had ever been exercised
 * with a real number, and a contradiction sitting in plain sight went unnoticed.
 */
import { describe, expect, it } from "vitest";

import { estimateLoadTax, type TaxEstimateInput } from "@/lib/tax/tax-domain";

function noteText(estimate: { notes: { text: string; detail?: string }[] }): string {
  return estimate.notes.map((n) => `${n.text} ${n.detail ?? ""}`).join(" ");
}

function us(overrides: Partial<TaxEstimateInput> = {}): TaxEstimateInput {
  return {
    customerRate: 2_400,
    carrierRate: 2_000,
    originRegion: "TX",
    destinationRegion: "GA",
    ...overrides,
  };
}

function cn(overrides: Partial<TaxEstimateInput> = {}): TaxEstimateInput {
  return {
    customerRate: 10_000,
    carrierRate: 8_000,
    originRegion: "Shanghai",
    destinationRegion: "Guangdong",
    ...overrides,
  };
}

const RATE = { enabled: true, usTransportRate: 0.0825, source: "s", asOf: "2026-08-20" } as const;

describe("sales tax is not a cost the broker bears", () => {
  /**
   * The worst of the four. `totalTaxCost` is documented as the true cash cost of
   * the movement's tax and the panel headlines it as "tax you bear". The US
   * branch was returning `salesTax + fuelTax` while the comment three lines above
   * said only fuel tax belonged there — invisible while `salesTax` was always
   * zero, and an overstatement of the load's cost by the full sales tax the
   * moment a manual rate made it non-zero.
   */
  it("excludes sales tax from the cost figure but keeps it in the payable figure", () => {
    const estimate = estimateLoadTax(
      us({ originRegion: "HI", destinationRegion: "HI", distanceMiles: 780, manualRates: RATE }),
    );
    expect(estimate.outputTax).toBe(198);
    expect(estimate.netTaxPayable).toBe(198);
    // Fuel tax only: 780 mi / 6.5 mpg × $0.34.
    expect(estimate.totalTaxCost).toBe(40.8);
  });

  /** Still visible as a line — excluded from the total, not hidden. */
  it("keeps the sales tax on screen as its own line", () => {
    const estimate = estimateLoadTax(
      us({ originRegion: "HI", destinationRegion: "HI", manualRates: RATE }),
    );
    expect(estimate.lines.find((l) => l.id === "us-sales-tax-manual")?.amount).toBe(198);
    expect(noteText(estimate)).toContain("billed to the customer and remitted");
  });

  it("says nothing about remittance when there is no sales tax to remit", () => {
    const estimate = estimateLoadTax(us({ distanceMiles: 780 }));
    expect(noteText(estimate)).not.toContain("billed to the customer and remitted");
  });

  /** China is unaffected: VAT payable genuinely is borne, after credits. */
  it("leaves the China total as payable plus surcharges", () => {
    const estimate = estimateLoadTax(cn());
    expect(estimate.totalTaxCost).toBe(184.96);
  });
});

describe("usesManualRates reports what was applied", () => {
  /**
   * Was a scan of line labels for the word "manual". That missed the China VAT
   * override entirely — it changed the rate while leaving the output-VAT label
   * untouched — so the badge went dark on the case where the figure moved most.
   *
   * Both halves are now fixed: the estimator reports the fact directly, and the
   * line says where its rate came from. The flag is asserted independently of the
   * label so it cannot quietly regress back to being label-derived.
   */
  it("is true for a China VAT override, and the line carries its provenance", () => {
    const estimate = estimateLoadTax(
      cn({ manualRates: { enabled: true, chinaVatRate: 0.06, source: "财政部 notice" } }),
    );
    expect(estimate.usesManualRates).toBe(true);

    const line = estimate.lines.find((l) => l.id === "cn-output-vat");
    expect(line?.rate).toBe(0.06);
    // On the line, not only in a note: the notes list is collapsed by default,
    // so provenance left there alone is invisible.
    expect(line?.detail).toContain("财政部 notice");
  });

  it("leaves the statutory output-VAT line free of manual provenance", () => {
    const line = estimateLoadTax(cn()).lines.find((l) => l.id === "cn-output-vat");
    expect(line?.detail).toBeUndefined();
    expect(line?.label).not.toMatch(/manual/i);
  });

  it("is true for each of the other three applied paths", () => {
    expect(
      estimateLoadTax(us({ originRegion: "HI", destinationRegion: "HI", manualRates: RATE }))
        .usesManualRates,
    ).toBe(true);
    expect(
      estimateLoadTax(
        us({ distanceMiles: 780, manualRates: { enabled: true, iftaRateUsdPerGallon: 0.5 } }),
      ).usesManualRates,
    ).toBe(true);
    expect(
      estimateLoadTax(cn({ manualRates: { enabled: true, chinaSurchargeRate: 0.2 } }))
        .usesManualRates,
    ).toBe(true);
  });

  it("is false where a configured rate could not be applied", () => {
    // Interstate — not a taxable sale at any rate.
    expect(estimateLoadTax(us({ manualRates: RATE })).usesManualRates).toBe(false);
    // Settled exemption — a manual rate does not overrule it.
    expect(
      estimateLoadTax(us({ originRegion: "CA", destinationRegion: "CA", manualRates: RATE }))
        .usesManualRates,
    ).toBe(false);
    // Published lane rates outrank the manual one.
    expect(
      estimateLoadTax(
        us({
          distanceMiles: 780,
          iftaRateOverride: 0.4,
          manualRates: { enabled: true, iftaRateUsdPerGallon: 0.5 },
        }),
      ).usesManualRates,
    ).toBe(false);
  });

  it("is false when nothing is configured, in every regime", () => {
    expect(estimateLoadTax(us()).usesManualRates).toBe(false);
    expect(estimateLoadTax(cn()).usesManualRates).toBe(false);
    // Unsupported: no jurisdiction, and Hong Kong.
    expect(estimateLoadTax({ customerRate: 100 }).usesManualRates).toBe(false);
    expect(estimateLoadTax({ customerRate: 100, originRegion: "Hong Kong" }).usesManualRates).toBe(
      false,
    );
  });
});

describe("a rate that changes no figure changes no confidence", () => {
  /**
   * A China surcharge override with nothing payable to levy on. The rate moved
   * no number, yet confidence was being downgraded from `statutory` to
   * `estimated` — an estimate marked less trustworthy for a reason the reader
   * cannot see anywhere on the panel.
   */
  it("keeps statutory confidence when there is no VAT payable to surcharge", () => {
    // Input credit exceeds output VAT, so nothing is payable.
    const estimate = estimateLoadTax(
      cn({ carrierRate: 20_000, manualRates: { enabled: true, chinaSurchargeRate: 0.2 } }),
    );
    expect(estimate.netTaxPayable).toBe(0);
    expect(estimate.surcharges).toBe(0);
    expect(estimate.confidence).toBe("statutory");
    expect(estimate.usesManualRates).toBe(false);
  });

  it("still downgrades when the surcharge rate does apply", () => {
    const estimate = estimateLoadTax(
      cn({ manualRates: { enabled: true, chinaSurchargeRate: 0.2 } }),
    );
    expect(estimate.surcharges).toBe(33.03);
    expect(estimate.confidence).toBe("estimated");
  });
});

describe("an unknown destination is not an interstate movement", () => {
  /**
   * With the delivery state blank, `intrastate` is false — so the interstate
   * branch fires and the new manual-rate note piled a second unfounded claim on
   * top of it. The underlying mislabelling is pre-existing; what is fixed here is
   * not making it worse.
   */
  it("does not claim the rate was skipped for being interstate", () => {
    const estimate = estimateLoadTax(
      us({ originRegion: "HI", destinationRegion: "", manualRates: RATE }),
    );
    expect(noteText(estimate)).not.toContain("The manual transportation tax rate from Settings");
  });

  it("does say so on a genuinely interstate lane", () => {
    const estimate = estimateLoadTax(
      us({ originRegion: "TX", destinationRegion: "GA", manualRates: RATE }),
    );
    expect(noteText(estimate)).toContain("interstate movement, which is not a taxable sale");
  });
});
