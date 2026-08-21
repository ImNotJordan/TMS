/**
 * Manual rates from Settings, as seen by the estimator.
 *
 * Kept separate from `tax-domain.test.ts` because the question is different:
 * that file asks what the statute says, this one asks what happens when an
 * operator supplies a rate the statute could not give us — and, just as
 * importantly, where a supplied rate is deliberately *not* used.
 */
import { describe, expect, it } from "vitest";

import { estimateLoadTax, type TaxEstimateInput } from "@/lib/tax/tax-domain";

/** All caveat text as one string, for assertions. */
function noteText(estimate: { notes: { text: string; detail?: string }[] }): string {
  return estimate.notes.map((n) => `${n.text} ${n.detail ?? ""}`).join(" ");
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

function us(overrides: Partial<TaxEstimateInput> = {}): TaxEstimateInput {
  return {
    customerRate: 2_400,
    carrierRate: 2_000,
    originRegion: "TX",
    destinationRegion: "GA",
    ...overrides,
  };
}

const MANUAL = {
  enabled: true,
  usTransportRate: 0.0825,
  source: "Avalara lookup",
  asOf: "2026-08-20",
} as const;

describe("manual US transportation rate", () => {
  /**
   * The whole point. `HI` is a state the estimator knows taxes transportation
   * but deliberately will not price, so it returns `indeterminate` and zero. A
   * rate entered in Settings turns that into a real figure — without changing
   * what the estimator claims to know, which is why confidence lands on
   * `estimated` and never `statutory`.
   */
  it("prices a taxable intrastate state it would otherwise refuse to price", () => {
    const estimate = estimateLoadTax(
      us({ originRegion: "HI", destinationRegion: "HI", manualRates: MANUAL }),
    );
    // 2,400 revenue at 8.25%.
    expect(estimate.outputTax).toBe(198);
    expect(estimate.netTaxPayable).toBe(198);
    expect(estimate.confidence).toBe("estimated");

    const line = estimate.lines.find((l) => l.id === "us-sales-tax-manual");
    expect(line?.rate).toBe(0.0825);
    expect(line?.basis).toBe(2_400);
    expect(line?.detail).toContain("8.25%");
  });

  it("prices a state it carries no determination for, and admits it did not verify taxability", () => {
    const estimate = estimateLoadTax(
      us({ originRegion: "OH", destinationRegion: "OH", manualRates: MANUAL }),
    );
    expect(estimate.outputTax).toBe(198);
    expect(noteText(estimate)).toContain("did not verify that transportation is taxable");
  });

  /**
   * A manual rate fills gaps; it does not overrule settled law. Charging tax in
   * a state that exempts freight would invent a liability, which is worse than
   * the blank it replaces.
   */
  it("does not override a state with a settled exemption", () => {
    const estimate = estimateLoadTax(
      us({ originRegion: "CA", destinationRegion: "CA", manualRates: MANUAL }),
    );
    expect(estimate.outputTax).toBe(0);
    expect(estimate.lines.some((l) => l.id === "us-sales-tax-manual")).toBe(false);
    expect(noteText(estimate)).toContain("not taxable");
  });

  /** Interstate freight is not a taxable sale, whatever rate is configured. */
  it("does not apply to an interstate movement, and says why", () => {
    const estimate = estimateLoadTax(
      us({ originRegion: "TX", destinationRegion: "GA", manualRates: MANUAL }),
    );
    expect(estimate.outputTax).toBe(0);
    expect(noteText(estimate)).toContain("interstate movement, which is not a taxable sale");
  });

  it("is inert when switched off, leaving the refusal intact", () => {
    const estimate = estimateLoadTax(
      us({
        originRegion: "HI",
        destinationRegion: "HI",
        manualRates: { ...MANUAL, enabled: false },
      }),
    );
    expect(estimate.outputTax).toBe(0);
    expect(estimate.confidence).toBe("indeterminate");
  });

  /** A deliberate zero is an answer: "I checked, and this state exempts it." */
  it("honours a zero rate as a determination rather than ignoring it", () => {
    const estimate = estimateLoadTax(
      us({
        originRegion: "HI",
        destinationRegion: "HI",
        manualRates: { enabled: true, usTransportRate: 0 },
      }),
    );
    expect(estimate.outputTax).toBe(0);
    // Not `indeterminate` — the operator answered the question.
    expect(estimate.confidence).toBe("estimated");
    expect(estimate.lines.some((l) => l.id === "us-sales-tax-manual")).toBe(true);
  });

  it("records provenance, and says so plainly when none was given", () => {
    const withSource = estimateLoadTax(
      us({ originRegion: "HI", destinationRegion: "HI", manualRates: MANUAL }),
    );
    const line = withSource.lines.find((l) => l.id === "us-sales-tax-manual");
    expect(line?.detail).toContain("Avalara lookup");
    expect(line?.detail).toContain("as of 2026-08-20");

    const without = estimateLoadTax(
      us({
        originRegion: "HI",
        destinationRegion: "HI",
        manualRates: { enabled: true, usTransportRate: 0.0825 },
      }),
    );
    expect(without.lines.find((l) => l.id === "us-sales-tax-manual")?.detail).toContain(
      "no source recorded",
    );
  });
});

describe("manual fuel rate precedence", () => {
  it("uses a manual fuel rate in place of the national blend", () => {
    const estimate = estimateLoadTax(
      us({ distanceMiles: 780, manualRates: { enabled: true, iftaRateUsdPerGallon: 0.5 } }),
    );
    // 780 / 6.5 = 120 gal at $0.50.
    const fuel = estimate.lines.find((l) => l.id === "us-ifta-fuel-tax");
    expect(fuel?.amount).toBe(60);
    expect(fuel?.label).toContain("manual IFTA rate");
  });

  /**
   * Live published rates beat a manual one, because the live figure is the
   * per-jurisdiction rate for *this lane* from the same matrix the operator would
   * have consulted by hand. The note is required: a setting that is quietly
   * ignored is indistinguishable from one that failed.
   */
  it("prefers published lane rates over a manual one, and says the manual went unused", () => {
    const estimate = estimateLoadTax(
      us({
        distanceMiles: 780,
        iftaRateOverride: 0.4,
        iftaRateSource: "IFTA 2026Q3",
        manualRates: { enabled: true, iftaRateUsdPerGallon: 0.5 },
      }),
    );
    const fuel = estimate.lines.find((l) => l.id === "us-ifta-fuel-tax");
    expect(fuel?.amount).toBe(48);
    expect(noteText(estimate)).toContain("manual IFTA rate from Settings was not used");
  });

  it("falls back to the blend when the manual rate is absent", () => {
    const estimate = estimateLoadTax(us({ distanceMiles: 780, manualRates: { enabled: true } }));
    const fuel = estimate.lines.find((l) => l.id === "us-ifta-fuel-tax");
    expect(fuel?.amount).toBe(40.8);
    expect(fuel?.label).toContain("blended rate");
  });
});

describe("manual China rates", () => {
  it("replaces the statutory VAT rate for a domestic movement", () => {
    const estimate = estimateLoadTax(cn({ manualRates: { enabled: true, chinaVatRate: 0.06 } }));
    const output = estimate.lines.find((l) => l.id === "cn-output-vat");
    expect(output?.rate).toBe(0.06);
    // Tax-inclusive by default: 10,000 − 10,000 ÷ 1.06.
    expect(output?.amount).toBe(566.04);
    expect(estimate.confidence).toBe("estimated");
    expect(noteText(estimate)).toContain("rather than the statutory rate");
  });

  /**
   * Zero-rating is a legal *status* that also preserves the input credit, and
   * the small-scale levy carries its own no-credit rule. Replacing either with a
   * typed percentage would change the regime, not just the number.
   */
  it("leaves the zero-rated cross-border and small-scale regimes alone", () => {
    const crossBorder = estimateLoadTax(
      cn({
        destinationRegion: "CA",
        destinationCountry: "US",
        manualRates: { enabled: true, chinaVatRate: 0.13 },
      }),
    );
    expect(crossBorder.lines.find((l) => l.id === "cn-output-vat")?.rate).toBe(0);

    const smallScale = estimateLoadTax(
      cn({ chinaTaxpayerKind: "smallScale", manualRates: { enabled: true, chinaVatRate: 0.13 } }),
    );
    expect(smallScale.lines.find((l) => l.id === "cn-output-vat")?.rate).toBe(0.03);
  });

  /**
   * A manual surcharge rate changes the percentage, never the base. Applying
   * surcharges to revenue instead of VAT payable is the error this module exists
   * to avoid, and an override must not reintroduce it.
   */
  it("applies a manual surcharge rate to VAT payable, not to revenue", () => {
    const estimate = estimateLoadTax(
      cn({ manualRates: { enabled: true, chinaSurchargeRate: 0.2 } }),
    );
    // Payable is 825.69 − 660.55 = 165.14; 20% of that, not of 10,000.
    expect(estimate.netTaxPayable).toBe(165.14);
    expect(estimate.surcharges).toBe(33.03);
    const line = estimate.lines.find((l) => l.id === "cn-surcharges");
    expect(line?.basis).toBe(165.14);
    expect(line?.rate).toBe(0.2);
  });
});

describe("inertness", () => {
  /**
   * The regression that matters most: every figure must be bit-identical when no
   * manual rate is in play, so turning the feature on for one workspace cannot
   * move numbers for another.
   */
  it("leaves every figure untouched when nothing is set", () => {
    for (const build of [cn, us]) {
      const bare = estimateLoadTax(build());
      expect(estimateLoadTax(build({ manualRates: { enabled: true } }))).toEqual(bare);
      expect(estimateLoadTax(build({ manualRates: { enabled: false } }))).toEqual(bare);
      expect(
        estimateLoadTax(build({ manualRates: { enabled: false, usTransportRate: 0.5 } })),
      ).toEqual(bare);
    }
  });

  it("keeps China statutory when only a US rate is configured, and vice versa", () => {
    const china = estimateLoadTax(cn({ manualRates: MANUAL }));
    expect(china.confidence).toBe("statutory");
    expect(china).toEqual(estimateLoadTax(cn()));

    const american = estimateLoadTax(
      us({
        originRegion: "HI",
        destinationRegion: "HI",
        manualRates: { enabled: true, chinaVatRate: 0.13 },
      }),
    );
    expect(american.confidence).toBe("indeterminate");
  });
});
