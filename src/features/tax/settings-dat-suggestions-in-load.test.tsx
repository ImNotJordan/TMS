/**
 * Does turning off "Show DAT Suggestions on Load Review" actually remove the
 * panel from the page the setting names?
 *
 * The Settings toggle used to be cosmetic: `StepReview` always rendered
 * `DatMarketPanel`. This file is the wiring test — `renderToStaticMarkup`
 * because the repo has no jsdom, same pattern as the tax review tests.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { StepReview } from "@/components/loads/create-load-dialog";
import { INITIAL, type LoadDraft } from "@/components/loads/create-load/create-load-types";
import { clearAppSettingsCache, setAppSettingsCache } from "@/lib/app-settings-store";

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

const DRAFT: LoadDraft = {
  ...INITIAL,
  loadId: "L-DAT-1",
  customer: "Acme",
  customerRate: "2400",
  carrierRate: "2000",
  pickupCity: "Dallas",
  pickupState: "TX",
  deliveryCity: "Atlanta",
  deliveryState: "GA",
  equipmentType: "dry-van",
};

const NO_ERRORS: Record<number, string[]> = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] };

function renderReview() {
  return textOf(
    renderToStaticMarkup(
      <StepReview draft={DRAFT} stepErrors={NO_ERRORS} onJump={() => {}} variant="create" />,
    ),
  );
}

afterEach(() => {
  clearAppSettingsCache();
});

describe("DAT suggestions on Load Review honour Integrations settings", () => {
  it("shows the DAT panel when the Load Review toggle is on", () => {
    setAppSettingsCache({ show_dat_suggestions_load_review: true });
    const text = renderReview();
    expect(text).toContain("DAT Market Suggestions");
    expect(text).toContain("DAT Capacity Score");
    expect(text).toContain("7-Day DAT Rate Band");
  });

  it("removes the DAT panel when the Load Review toggle is off", () => {
    setAppSettingsCache({ show_dat_suggestions_load_review: false });
    const text = renderReview();
    expect(text).not.toContain("DAT Market Suggestions");
    expect(text).not.toContain("DAT Capacity Score");
  });

  it("hides rate blocks when DAT rate data is off", () => {
    setAppSettingsCache({
      show_dat_suggestions_load_review: true,
      enable_dat_rate_data: false,
      enable_dat_capacity_data: true,
    });
    const text = renderReview();
    expect(text).toContain("DAT Market Suggestions");
    expect(text).toContain("DAT Capacity Score");
    expect(text).not.toContain("7-Day DAT Rate Band");
  });

  it("hides capacity blocks when DAT capacity data is off", () => {
    setAppSettingsCache({
      show_dat_suggestions_load_review: true,
      enable_dat_capacity_data: false,
      enable_dat_rate_data: true,
    });
    const text = renderReview();
    expect(text).toContain("DAT Market Suggestions");
    expect(text).toContain("7-Day DAT Rate Band");
    expect(text).not.toContain("DAT Capacity Score");
  });
});
