/**
 * Does the tax estimate actually reach the screen a user looks at?
 *
 * The unit tests in `tax-domain.test.ts` prove the arithmetic. They prove
 * nothing about whether the number is rendered, and the first version of this
 * feature wired the panel next to `StepReview` on the load detail page while the
 * create-load wizard renders the *same* `StepReview` with no panel beside it. So
 * a load created through the wizard showed no tax on its review step, and every
 * arithmetic test still passed.
 *
 * Rendered with `react-dom/server` rather than a DOM testing library: this repo
 * has no jsdom and no @testing-library, and `renderToStaticMarkup` needs neither.
 * It cannot click, but the question here is "is the figure present in the
 * output", which is exactly what static markup answers.
 *
 * `useFormat()` and `useT()` resolve against their context defaults, so no
 * provider wrapper is needed — the same reason the panel works before the
 * workspace settings have loaded.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StepReview } from "@/components/loads/create-load-dialog";
import { LoadTaxPanel } from "@/features/tax/load-tax-panel";
import { buildTaxInput, grossRevenueOf } from "@/features/tax/use-load-tax";
import { estimateLoadTax } from "@/lib/tax/tax-domain";
import { INITIAL, type LoadDraft } from "@/components/loads/create-load/create-load-types";

/** Text content only — class names carry digits and would produce false matches. */
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

function draftFor(overrides: Partial<LoadDraft>): LoadDraft {
  return { ...INITIAL, ...overrides };
}

/** A brokered China lane: ¥10,000 sell, ¥8,000 buy. */
const CHINA_DRAFT = draftFor({
  loadId: "L-CN-1",
  customer: "Acme CN",
  customerRate: "10000",
  carrierRate: "8000",
  pickupState: "Shanghai",
  pickupCity: "Shanghai",
  deliveryState: "Guangdong",
  deliveryCity: "Shenzhen",
});

/** A US interstate lane: $2,400 sell, $2,000 buy. */
const US_DRAFT = draftFor({
  loadId: "L-US-1",
  customer: "Acme US",
  customerRate: "2400",
  carrierRate: "2000",
  pickupState: "TX",
  pickupCity: "Dallas",
  deliveryState: "GA",
  deliveryCity: "Atlanta",
});

const NO_ERRORS: Record<number, string[]> = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] };

function renderReview(draft: LoadDraft, variant: "create" | "edit") {
  return textOf(
    renderToStaticMarkup(
      <StepReview draft={draft} stepErrors={NO_ERRORS} onJump={() => {}} variant={variant} />,
    ),
  );
}

describe("the tax panel renders a figure", () => {
  it("shows the netted China VAT amount", () => {
    const estimate = estimateLoadTax(buildTaxInput(CHINA_DRAFT));
    const text = textOf(
      renderToStaticMarkup(
        <LoadTaxPanel estimate={estimate} grossRevenue={grossRevenueOf(CHINA_DRAFT)} />,
      ),
    );

    expect(text).toContain("Tax estimate");
    // 825.69 output − 660.55 credit = 165.14 payable, + 19.82 surcharges = 184.96.
    expect(text).toContain("184.96");
    expect(text).toContain("825.69");
    expect(text).toContain("660.55");
    // Rendered in the jurisdiction's own currency, not the workspace default.
    expect(text).toContain("CN¥");
    expect(text).not.toContain("$184.96");
  });

  it("shows the US interstate case as no sales tax, with fuel tax when miles are known", () => {
    const estimate = estimateLoadTax(buildTaxInput(US_DRAFT, { distanceMiles: 780 }));
    const text = textOf(
      renderToStaticMarkup(
        <LoadTaxPanel estimate={estimate} grossRevenue={grossRevenueOf(US_DRAFT)} />,
      ),
    );

    expect(text).toContain("Interstate");
    // 780 mi / 6.5 mpg * $0.34 = $40.80
    expect(text).toContain("40.80");
    expect(text).toContain("$");
  });

  it("carries its own caveats, so a figure never travels bare", () => {
    const estimate = estimateLoadTax(buildTaxInput(CHINA_DRAFT));
    const text = textOf(
      renderToStaticMarkup(
        <LoadTaxPanel estimate={estimate} grossRevenue={grossRevenueOf(CHINA_DRAFT)} />,
      ),
    );
    expect(text).toContain("Not tax advice");
    expect(text).toContain("Statutory");
  });
});

describe("the Review step shows tax", () => {
  /**
   * The regression this file exists for. `StepReview` is rendered by the
   * create-load wizard at step 7 *and* by the load detail page, so putting the
   * panel inside it is what makes tax visible in both — wiring it beside one
   * caller leaves the other blank.
   */
  it("appears in the create wizard's review step", () => {
    const text = renderReview(CHINA_DRAFT, "create");
    expect(text).toContain("Tax estimate");
    expect(text).toContain("184.96");
  });

  it("appears in the detail page's review step", () => {
    const text = renderReview(CHINA_DRAFT, "edit");
    expect(text).toContain("Tax estimate");
    expect(text).toContain("184.96");
  });

  it("shows the US figure in the review step too", () => {
    const text = renderReview(US_DRAFT, "create");
    expect(text).toContain("Tax estimate");
    expect(text).toContain("Interstate");
  });

  /**
   * A half-filled draft is the normal state while someone is still working
   * through the wizard. The review step must not throw or print NaN.
   */
  it("survives a draft with no rates entered yet", () => {
    const text = renderReview(draftFor({ loadId: "L-EMPTY" }), "create");
    expect(text).toContain("Tax estimate");
    expect(text).not.toContain("NaN");
    expect(text).not.toContain("undefined");
  });

  it("says so plainly when the lane is outside the supported jurisdictions", () => {
    const text = renderReview(
      draftFor({ customerRate: "1000", pickupState: "Bavaria", deliveryState: "Lombardy" }),
      "create",
    );
    expect(text).toContain("Tax estimate");
    expect(text).toContain("United States and mainland China");
  });
});
