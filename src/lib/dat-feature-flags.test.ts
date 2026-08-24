import { afterEach, describe, expect, it } from "vitest";

import { clearAppSettingsCache, setAppSettingsCache } from "@/lib/app-settings-store";

import { readDatFeatureFlags } from "./dat-feature-flags";

afterEach(() => {
  clearAppSettingsCache();
});

describe("readDatFeatureFlags", () => {
  it("keeps DAT suggestions on when the company has never saved Integrations", () => {
    const flags = readDatFeatureFlags({});
    expect(flags.showOnLoadReview).toBe(true);
    expect(flags.showOnTruckboard).toBe(true);
    expect(flags.showLoadReviewRates).toBe(true);
    expect(flags.showLoadReviewCapacity).toBe(true);
  });

  it("hides Load Review suggestions when that toggle is off", () => {
    const flags = readDatFeatureFlags({ show_dat_suggestions_load_review: false });
    expect(flags.showOnLoadReview).toBe(false);
    expect(flags.showLoadReviewRates).toBe(false);
    expect(flags.showLoadReviewCapacity).toBe(false);
    expect(flags.showOnTruckboard).toBe(true);
  });

  it("hides TruckBoard suggestions when that toggle is off", () => {
    const flags = readDatFeatureFlags({ show_dat_suggestions_truckboard: false });
    expect(flags.showOnTruckboard).toBe(false);
    expect(flags.showOnLoadReview).toBe(true);
  });

  it("hides rate blocks when DAT rate data is off, without killing capacity", () => {
    const flags = readDatFeatureFlags({ enable_dat_rate_data: false });
    expect(flags.rateData).toBe(false);
    expect(flags.showLoadReviewRates).toBe(false);
    expect(flags.showLoadReviewCapacity).toBe(true);
    expect(flags.showOnLoadReview).toBe(true);
  });

  it("hides capacity blocks when DAT capacity data is off, without killing rates", () => {
    const flags = readDatFeatureFlags({ enable_dat_capacity_data: false });
    expect(flags.capacityData).toBe(false);
    expect(flags.showLoadReviewCapacity).toBe(false);
    expect(flags.showLoadReviewRates).toBe(true);
  });

  it("hides the whole Load Review panel when both DAT data types are off", () => {
    const flags = readDatFeatureFlags({
      enable_dat_capacity_data: false,
      enable_dat_rate_data: false,
    });
    expect(flags.showOnLoadReview).toBe(false);
    expect(flags.showOnTruckboard).toBe(false);
  });

  it("honours the in-memory settings cache when no bag is passed", () => {
    setAppSettingsCache({ show_dat_suggestions_load_review: false });
    expect(readDatFeatureFlags().showOnLoadReview).toBe(false);
  });
});
