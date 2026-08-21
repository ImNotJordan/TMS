/**
 * Do rates entered in Settings actually change the tax shown while building a load?
 *
 * The domain tests prove the arithmetic honours a manual rate, and the settings
 * module tests prove the strings parse. Neither proves the *wiring*: that
 * `Settings → Tax Estimation` feeds `buildTaxInput`, which feeds the estimate,
 * which reaches the review step a broker actually reads. That path has three
 * seams in it and each one is a place a value can be silently dropped.
 *
 * Rendered with `react-dom/server`, for the reasons given in
 * `load-tax-review.test.tsx` — this repo has no jsdom.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { StepReview } from "@/components/loads/create-load-dialog";
import { buildTaxInput, readManualRateSettings } from "@/features/tax/use-load-tax";
import { estimateLoadTax } from "@/lib/tax/tax-domain";
import { setAppSettingsCache, type AppSettingsData } from "@/lib/app-settings-store";
import { INITIAL, type LoadDraft } from "@/components/loads/create-load/create-load-types";

function textOf(markup: string): string {
  return markup
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#x2F;/g, "/")
    .replace(/\s+/g, " ")
    .trim();
}

/** Hawaii taxes intrastate transportation, and the estimator will not price it unaided. */
const HAWAII_INTRASTATE: LoadDraft = {
  ...INITIAL,
  loadId: "L-HI-1",
  customer: "Acme HI",
  customerRate: "2400",
  carrierRate: "2000",
  pickupState: "HI",
  pickupCity: "Honolulu",
  deliveryState: "HI",
  deliveryCity: "Hilo",
};

const MANUAL_RATE_SETTINGS: AppSettingsData = {
  tax_manual_rates_enabled: true,
  tax_manual_us_transport_percent: "4.712",
  tax_manual_rate_source: "Hawaii DOTAX GET schedule",
  tax_manual_rate_as_of: "2026-08-20",
};

const NO_ERRORS: Record<number, string[]> = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] };

function renderReview(draft: LoadDraft): string {
  return textOf(
    renderToStaticMarkup(
      <StepReview draft={draft} stepErrors={NO_ERRORS} onJump={() => {}} variant="create" />,
    ),
  );
}

afterEach(() => {
  // The cache is module-level. Leaving a rate behind would silently change every
  // later test in the run.
  setAppSettingsCache({});
});

describe("Settings → load building", () => {
  it("carries a configured rate through to the estimate", () => {
    setAppSettingsCache({});
    const without = estimateLoadTax(buildTaxInput(HAWAII_INTRASTATE));
    expect(without.confidence).toBe("indeterminate");
    expect(without.outputTax).toBe(0);

    setAppSettingsCache(MANUAL_RATE_SETTINGS);
    const withRate = estimateLoadTax(buildTaxInput(HAWAII_INTRASTATE));
    // 2,400 at 4.712%.
    expect(withRate.outputTax).toBe(113.09);
    expect(withRate.confidence).toBe("estimated");
  });

  it("reads the stored strings the Settings page writes", () => {
    setAppSettingsCache(MANUAL_RATE_SETTINGS);
    const { rates, problems } = readManualRateSettings();
    expect(problems).toEqual([]);
    expect(rates).toMatchObject({
      enabled: true,
      usTransportRate: 0.04712,
      source: "Hawaii DOTAX GET schedule",
      asOf: "2026-08-20",
    });
  });

  /** The toggle has to actually gate it, or turning it off would be cosmetic. */
  it("stops applying the rate when the toggle is off", () => {
    setAppSettingsCache({ ...MANUAL_RATE_SETTINGS, tax_manual_rates_enabled: false });
    const estimate = estimateLoadTax(buildTaxInput(HAWAII_INTRASTATE));
    expect(estimate.outputTax).toBe(0);
    expect(estimate.confidence).toBe("indeterminate");
  });

  /** A mistyped rate must fall back, not become 0.09% of revenue. */
  it("ignores a rate typed as a fraction rather than applying it", () => {
    setAppSettingsCache({
      tax_manual_rates_enabled: true,
      tax_manual_us_transport_percent: "0.04712",
    });
    expect(readManualRateSettings().problems).toHaveLength(1);
    const estimate = estimateLoadTax(buildTaxInput(HAWAII_INTRASTATE));
    expect(estimate.outputTax).toBe(0);
    expect(estimate.confidence).toBe("indeterminate");
  });

  /* ---- Reaching the screen ---- */

  it("shows the figure and its provenance on the review step", () => {
    setAppSettingsCache(MANUAL_RATE_SETTINGS);
    const text = renderReview(HAWAII_INTRASTATE);

    expect(text).toContain("113.09");
    // Which rate, and where it came from — next to the number, not buried.
    expect(text).toContain("4.712%");
    expect(text).toContain("Hawaii DOTAX GET schedule");
    expect(text).toContain("as of 2026-08-20");
  });

  it("labels the source so a Settings rate is not mistaken for a determination", () => {
    setAppSettingsCache(MANUAL_RATE_SETTINGS);
    const text = renderReview(HAWAII_INTRASTATE);
    expect(text).toContain("Settings rate");
    expect(text.toLowerCase()).toContain("manual rate from settings");
  });

  it("shows no such badge when no rate is configured", () => {
    setAppSettingsCache({});
    const text = renderReview(HAWAII_INTRASTATE);
    expect(text).not.toContain("Settings rate");
  });

  /**
   * A configured rate is not an applied one. An interstate load must not show
   * the badge, because the rate genuinely did not shape the figure — showing it
   * would misattribute a zero to a rate that was never used.
   */
  it("does not claim a Settings rate on an interstate load it cannot apply to", () => {
    setAppSettingsCache(MANUAL_RATE_SETTINGS);
    const interstate: LoadDraft = { ...HAWAII_INTRASTATE, deliveryState: "CA", pickupState: "TX" };
    const text = renderReview(interstate);
    expect(text).not.toContain("Settings rate");
  });

  /**
   * The headline is `totalTaxCost`, which deliberately excludes sales tax
   * because it is collected from the customer rather than borne. That makes a
   * sales-tax-only load headline as zero — true, but it reads at a glance as "no
   * tax", so the remittance has to be stated beside it. A footnote does not
   * count: nobody weighs one against a number in 24px type.
   */
  it("states the remittance beside a headline that reads as zero cost", () => {
    setAppSettingsCache(MANUAL_RATE_SETTINGS);
    const text = renderReview(HAWAII_INTRASTATE);
    expect(text).toContain("Sales tax to collect and remit");
    expect(text).toContain("113.09");
    expect(text).toContain("not a cost you bear");
  });

  it("says nothing about remittance on a load with no sales tax", () => {
    setAppSettingsCache({});
    const text = renderReview({ ...HAWAII_INTRASTATE, pickupState: "TX", deliveryState: "GA" });
    expect(text).not.toContain("Sales tax to collect and remit");
  });

  /**
   * The badge previously came from scanning line labels for "manual", which
   * missed the China VAT override — that path leaves its line label untouched.
   * It now reads the estimator's own flag.
   */
  it("badges a China VAT override, whose line label never says manual", () => {
    setAppSettingsCache({
      tax_manual_rates_enabled: true,
      tax_manual_cn_vat_percent: "6",
      tax_manual_rate_source: "Verified against 财政部 notice",
    });
    const china: LoadDraft = {
      ...INITIAL,
      loadId: "L-CN-1",
      customerRate: "10000",
      carrierRate: "8000",
      pickupState: "Shanghai",
      pickupCity: "Shanghai",
      deliveryState: "Guangdong",
      deliveryCity: "Shenzhen",
    };
    const text = renderReview(china);
    expect(text).toContain("Settings rate");
    expect(text).toContain("Verified against 财政部 notice");
  });
});
