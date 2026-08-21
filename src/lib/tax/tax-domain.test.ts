import { describe, expect, it } from "vitest";

import {
  effectiveTaxRate,
  estimateLoadTax,
  isChineseSAR,
  parseMoney,
  resolveCountry,
  splitVat,
  type TaxEstimateInput,
} from "@/lib/tax/tax-domain";
import { TAX_RATE_SNAPSHOT } from "@/lib/tax/tax-rates";

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

describe("resolveCountry", () => {
  it("recognizes US states", () => {
    expect(resolveCountry("TX")).toBe("US");
    expect(resolveCountry("ca")).toBe("US");
    expect(resolveCountry("DC")).toBe("US");
  });

  it("recognizes Chinese provinces in several spellings", () => {
    expect(resolveCountry("Shanghai")).toBe("CN");
    expect(resolveCountry("上海")).toBe("CN");
    expect(resolveCountry("guangdong")).toBe("CN");
    expect(resolveCountry("Inner Mongolia")).toBe("CN");
  });

  /**
   * `CA` is California, not Canada. Both readings are plausible for a two-letter
   * code and only one of them is what a US-built form means.
   */
  it("reads CA as California", () => {
    expect(resolveCountry("CA")).toBe("US");
  });

  it("returns UNKNOWN rather than guessing", () => {
    expect(resolveCountry("Bavaria")).toBe("UNKNOWN");
    expect(resolveCountry("")).toBe("UNKNOWN");
    expect(resolveCountry(undefined)).toBe("UNKNOWN");
  });

  it("lets an explicit country override inference", () => {
    expect(resolveCountry("Bavaria", "CN")).toBe("CN");
    expect(resolveCountry("TX", "CN")).toBe("CN");
    expect(resolveCountry("TX", "UNKNOWN")).toBe("US");
  });

  it("treats the SARs as separate systems", () => {
    expect(isChineseSAR("Hong Kong")).toBe(true);
    expect(isChineseSAR("香港")).toBe(true);
    expect(isChineseSAR("Shanghai")).toBe(false);
  });
});

describe("splitVat", () => {
  /**
   * The inclusive branch is the one that misstates every Chinese load if it is
   * wrong. ¥10,000 tax-inclusive at 9% carries ¥825.69 of VAT, not ¥900.
   */
  it("extracts VAT from a tax-inclusive amount", () => {
    expect(splitVat(10_000, 0.09, true)).toEqual({ net: 9174.31, vat: 825.69 });
  });

  it("adds VAT to a tax-exclusive amount", () => {
    expect(splitVat(10_000, 0.09, false)).toEqual({ net: 10_000, vat: 900 });
  });

  it("is a no-op at a zero rate", () => {
    expect(splitVat(10_000, 0, true)).toEqual({ net: 10_000, vat: 0 });
  });

  /**
   * Both halves are rounded to cents independently, so they can drift from the
   * gross by a cent. Anything larger means the split is wrong, not rounded.
   */
  it("net plus vat reconstructs the gross on the inclusive path", () => {
    for (const gross of [7_777.77, 10_000, 1_234.56, 0.03]) {
      const { net, vat } = splitVat(gross, 0.06, true);
      expect(Math.abs(net + vat - gross), String(gross)).toBeLessThanOrEqual(0.01);
    }
  });
});

describe("China VAT", () => {
  it("charges 9% on transportation and credits the carrier leg", () => {
    const estimate = estimateLoadTax(cn());

    expect(estimate.country).toBe("CN");
    expect(estimate.currency).toBe("CNY");
    expect(estimate.regime).toBe("china-vat");
    // Inclusive by default: 10,000 → 825.69 output, 8,000 → 660.55 credit.
    expect(estimate.outputTax).toBe(825.69);
    expect(estimate.inputCredit).toBe(660.55);
    expect(estimate.netTaxPayable).toBe(165.14);
    // 12% of net for a city-tier taxpayer.
    expect(estimate.surcharges).toBe(19.82);
    expect(estimate.totalTaxCost).toBe(184.96);
    expect(estimate.confidence).toBe("statutory");
  });

  /**
   * The most valuable thing this module computes. A missing special VAT invoice
   * turns a ¥185 tax cost into a ¥925 one on the same load — the tax is on
   * revenue rather than on value added.
   */
  it("costs several times more when the carrier issues no special VAT invoice", () => {
    const withInvoice = estimateLoadTax(cn({ carrierIssuesSpecialVatInvoice: true }));
    const without = estimateLoadTax(cn({ carrierIssuesSpecialVatInvoice: false }));

    expect(without.inputCredit).toBe(0);
    expect(without.netTaxPayable).toBe(825.69);
    expect(without.totalTaxCost).toBeGreaterThan(withInvoice.totalTaxCost * 4);
    expect(noteText(without)).toContain("增值税专用发票");
  });

  it("bills freight forwarding at 6% rather than 9%", () => {
    const forwarding = estimateLoadTax(cn({ chinaServiceKind: "logisticsAuxiliary" }));
    const carriage = estimateLoadTax(cn({ chinaServiceKind: "transportation" }));
    expect(forwarding.outputTax).toBeLessThan(carriage.outputTax);
    expect(forwarding.lines[0].rate).toBe(0.06);
  });

  it("gives a small-scale taxpayer no input credit at all", () => {
    const estimate = estimateLoadTax(cn({ chinaTaxpayerKind: "smallScale" }));
    expect(estimate.lines[0].rate).toBe(0.03);
    expect(estimate.inputCredit).toBe(0);
    expect(estimate.netTaxPayable).toBe(estimate.outputTax);
    expect(noteText(estimate)).toContain("cannot claim");
  });

  it("adds VAT on top when amounts are exclusive", () => {
    const estimate = estimateLoadTax(cn({ amountsIncludeVat: false }));
    expect(estimate.outputTax).toBe(900);
    expect(estimate.inputCredit).toBe(720);
    expect(estimate.netTaxPayable).toBe(180);
  });

  it("scales surcharges by the registered tier, on net VAT", () => {
    const city = estimateLoadTax(cn({ chinaSurchargeTier: "city" }));
    const other = estimateLoadTax(cn({ chinaSurchargeTier: "other" }));
    // 12% vs 6% of the same net figure.
    expect(city.surcharges).toBeGreaterThan(other.surcharges);
    expect(other.surcharges).toBe(Math.round(other.netTaxPayable * 0.06 * 100) / 100);
  });

  it("levies no surcharge when a credit wipes out the VAT", () => {
    const estimate = estimateLoadTax(cn({ customerRate: 8_000, carrierRate: 8_000 }));
    expect(estimate.netTaxPayable).toBe(0);
    expect(estimate.surcharges).toBe(0);
    expect(estimate.totalTaxCost).toBe(0);
  });

  it("floors at zero and explains a carried-forward surplus", () => {
    const estimate = estimateLoadTax(cn({ customerRate: 5_000, carrierRate: 8_000 }));
    expect(estimate.netTaxPayable).toBe(0);
    expect(noteText(estimate)).toContain("carries");
  });

  it("zero-rates a cross-border movement out of China", () => {
    const estimate = estimateLoadTax(cn({ destinationRegion: "TX" }));
    expect(estimate.crossBorder).toBe(true);
    expect(estimate.outputTax).toBe(0);
    // The credit survives zero-rating — that is the point of zero-rating.
    expect(estimate.inputCredit).toBeGreaterThan(0);
    expect(noteText(estimate)).toContain("zero-rated");
  });

  it("taxes fuel surcharge and accessorials with the freight", () => {
    const bare = estimateLoadTax(cn({ fuelSurcharge: 0, accessorialCharges: 0 }));
    const loaded = estimateLoadTax(cn({ fuelSurcharge: 1_000, accessorialCharges: 500 }));
    expect(loaded.outputTax).toBeGreaterThan(bare.outputTax);
  });

  it("counts other creditable input VAT", () => {
    const estimate = estimateLoadTax(cn({ otherCreditableInputVat: 100 }));
    expect(estimate.inputCredit).toBe(760.55);
  });
});

describe("United States", () => {
  it("estimates no sales tax on an interstate movement", () => {
    const estimate = estimateLoadTax(us());
    expect(estimate.country).toBe("US");
    expect(estimate.currency).toBe("USD");
    expect(estimate.intrastate).toBe(false);
    expect(estimate.outputTax).toBe(0);
    expect(noteText(estimate)).toContain("Interstate movement");
  });

  it("recognizes an intrastate movement", () => {
    const estimate = estimateLoadTax(us({ originRegion: "TX", destinationRegion: "TX" }));
    expect(estimate.intrastate).toBe(true);
    expect(noteText(estimate)).toContain("Intrastate");
  });

  it("says exempt where the state's treatment is settled", () => {
    const estimate = estimateLoadTax(us({ originRegion: "CA", destinationRegion: "CA" }));
    expect(estimate.outputTax).toBe(0);
    expect(noteText(estimate)).toContain("not taxable");
  });

  /**
   * The honest half of the US answer: name the exposure, refuse to invent a
   * combined state-and-local rate for it.
   */
  it("refuses to invent a rate for a taxable intrastate state", () => {
    const estimate = estimateLoadTax(us({ originRegion: "HI", destinationRegion: "HI" }));
    expect(estimate.confidence).toBe("indeterminate");
    expect(estimate.outputTax).toBe(0);
    expect(noteText(estimate)).toContain("connect a tax provider");
  });

  it("flags an unsettled state rather than assuming exempt", () => {
    const estimate = estimateLoadTax(us({ originRegion: "OH", destinationRegion: "OH" }));
    expect(estimate.confidence).toBe("indeterminate");
    expect(noteText(estimate)).toContain("will not invent one");
  });

  it("estimates fuel tax from lane distance", () => {
    const estimate = estimateLoadTax(us({ distanceMiles: 780 }));
    const fuel = estimate.lines.find((line) => line.id === "us-ifta-fuel-tax");
    expect(fuel).toBeDefined();
    // 780 mi / 6.5 mpg = 120 gal * $0.34 = $40.80
    expect(fuel?.amount).toBe(40.8);
    expect(estimate.totalTaxCost).toBe(40.8);
    expect(estimate.confidence).toBe("estimated");
  });

  it("honours a workspace fuel-economy figure", () => {
    const thirsty = estimateLoadTax(us({ distanceMiles: 780, truckMilesPerGallon: 5 }));
    const efficient = estimateLoadTax(us({ distanceMiles: 780, truckMilesPerGallon: 8 }));
    expect(thirsty.totalTaxCost).toBeGreaterThan(efficient.totalTaxCost);
  });

  it("accepts kilometres for a lane quoted metric", () => {
    const metric = estimateLoadTax(us({ distanceKm: 1_000 }));
    const imperial = estimateLoadTax(us({ distanceMiles: 1_000 / 1.609344 }));
    expect(metric.totalTaxCost).toBe(imperial.totalTaxCost);
  });

  it("estimates no fuel tax without a distance, and says why", () => {
    const estimate = estimateLoadTax(us({ distanceMiles: undefined }));
    expect(estimate.lines.some((l) => l.id === "us-ifta-fuel-tax")).toBe(false);
    expect(noteText(estimate)).toContain("No lane distance");
  });

  it("names weight-distance states it cannot compute", () => {
    const estimate = estimateLoadTax(
      us({ originRegion: "KY", destinationRegion: "NM", distanceMiles: 500 }),
    );
    // The sentence is static so it can be translated; the state codes ride in
    // `detail`, which is rendered verbatim.
    const weightNote = estimate.notes.find((n) => n.text.includes("weight-distance"));
    expect(weightNote?.detail).toBe("KY, NM");
  });

  it("always discloses what it excludes", () => {
    const estimate = estimateLoadTax(us({ distanceMiles: 100 }));
    const notes = noteText(estimate);
    expect(notes).toContain("Form 2290");
    expect(notes).toContain("never for filing");
  });
});

describe("jurisdiction fallbacks", () => {
  it("refuses to estimate for an unsupported country", () => {
    const estimate = estimateLoadTax({
      customerRate: 1_000,
      originRegion: "Bavaria",
      destinationRegion: "Lombardy",
    });
    expect(estimate.regime).toBe("unsupported");
    expect(estimate.confidence).toBe("indeterminate");
    expect(estimate.totalTaxCost).toBe(0);
    expect(noteText(estimate)).toContain("United States and mainland China");
  });

  it("declines the SARs, which levy no VAT", () => {
    const estimate = estimateLoadTax(cn({ destinationRegion: "Hong Kong" }));
    expect(estimate.regime).toBe("unsupported");
    expect(noteText(estimate)).toContain("separate tax systems");
  });

  it("falls back to the destination when the origin is unknown", () => {
    const estimate = estimateLoadTax({
      customerRate: 1_000,
      originRegion: "",
      destinationRegion: "Shanghai",
    });
    expect(estimate.country).toBe("CN");
  });

  it("stamps the rate snapshot on every result", () => {
    for (const input of [cn(), us(), { customerRate: 1, originRegion: "Nowhere" }]) {
      expect(estimateLoadTax(input).rateSnapshot).toBe(TAX_RATE_SNAPSHOT);
    }
  });
});

describe("effectiveTaxRate", () => {
  /**
   * The sanity check an operator can actually perform. A credited Chinese
   * brokered load lands near 2% of revenue — not the 9% headline rate.
   */
  it("shows a credited China load costing far less than the headline rate", () => {
    const estimate = estimateLoadTax(cn());
    const rate = effectiveTaxRate(estimate, 10_000);
    expect(rate).not.toBeNull();
    expect(rate!).toBeLessThan(0.03);
    expect(rate!).toBeGreaterThan(0.01);
  });

  it("returns null rather than dividing by zero", () => {
    expect(effectiveTaxRate(estimateLoadTax(cn()), 0)).toBeNull();
    expect(effectiveTaxRate(estimateLoadTax(cn()), Number.NaN)).toBeNull();
  });
});

describe("parseMoney", () => {
  it("reads the string money fields on LoadRecord", () => {
    expect(parseMoney("2400")).toBe(2400);
    expect(parseMoney("$2,400.50")).toBe(2400.5);
    expect(parseMoney("¥10,000")).toBe(10000);
    expect(parseMoney(2400)).toBe(2400);
  });

  it("returns undefined rather than zero for absent input", () => {
    // The distinction matters: zero is a rate of zero, undefined is "not entered".
    expect(parseMoney("")).toBeUndefined();
    expect(parseMoney(undefined)).toBeUndefined();
    expect(parseMoney("n/a")).toBeUndefined();
    expect(parseMoney(Number.NaN)).toBeUndefined();
  });
});

describe("notes and labels are translatable", () => {
  /**
   * The i18n constraint the estimator has to respect: phrase-keyed translation
   * looks a string up verbatim, so a sentence with a number baked into it can
   * never be translated. Every note and label must therefore be a fixed
   * sentence, with the varying part in `detail`.
   */
  /**
   * Tests the property directly rather than pattern-matching for digits: a
   * *static* sentence is one that does not change when the numbers change. A
   * regex looking for embedded amounts flags the IFTA note's fixed "$0.19 to
   * $0.97 per gallon" reference range, which is the same in every render and
   * perfectly translatable.
   */
  it("produces note text that does not vary with the numbers", () => {
    const texts = (input: TaxEstimateInput) => estimateLoadTax(input).notes.map((n) => n.text);
    const labels = (input: TaxEstimateInput) => estimateLoadTax(input).lines.map((l) => l.label);

    const variations: [TaxEstimateInput, TaxEstimateInput][] = [
      [cn({ customerRate: 10_000 }), cn({ customerRate: 77_777.77 })],
      [
        cn({ carrierIssuesSpecialVatInvoice: false, carrierRate: 8_000 }),
        cn({ carrierIssuesSpecialVatInvoice: false, carrierRate: 3_333.33 }),
      ],
      [
        cn({ customerRate: 5_000, carrierRate: 8_000 }),
        cn({ customerRate: 1_000, carrierRate: 9_999.99 }),
      ],
      [us({ distanceMiles: 780 }), us({ distanceMiles: 1_234 })],
      [
        us({ originRegion: "HI", destinationRegion: "HI" }),
        us({ originRegion: "NM", destinationRegion: "NM" }),
      ],
    ];

    for (const [a, b] of variations) {
      expect(texts(a)).toEqual(texts(b));
      expect(labels(a)).toEqual(labels(b));
    }
  });

  it("carries the varying part in detail instead", () => {
    const estimate = estimateLoadTax(us({ distanceMiles: 780 }));
    const fuel = estimate.lines.find((line) => line.id === "us-ifta-fuel-tax");
    expect(fuel?.label).not.toContain("780");
    expect(fuel?.detail).toContain("780 mi");
  });

  it("labels surcharges without baking the tier into the sentence", () => {
    const estimate = estimateLoadTax(cn({ chinaSurchargeTier: "county" }));
    const surcharge = estimate.lines.find((line) => line.id === "cn-surcharges");
    expect(surcharge?.label).not.toContain("county");
    expect(surcharge?.detail).toBe("county");
  });
});
