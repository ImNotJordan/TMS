import { afterEach, describe, expect, it } from "vitest";

import { stampStoredLoadTax, STORED_TAX_ESTIMATE_SOURCE, withStoredLoadTax } from "./stamp-load-tax";
import { setAppSettingsCache } from "@/lib/app-settings-store";

const HAWAII = {
  customerRate: "2400",
  pickupState: "HI",
  deliveryState: "HI",
};

const SETTINGS = {
  tax_manual_rates_enabled: true,
  tax_manual_us_transport_percent: "4.712",
};

afterEach(() => {
  setAppSettingsCache({});
});

describe("stampStoredLoadTax", () => {
  it("writes the Settings-backed preview figure so Dynamo matches the review step", () => {
    setAppSettingsCache(SETTINGS);
    const stamped = stampStoredLoadTax(HAWAII);
    expect(stamped.taxManualAmount).toBe("113.09");
    expect(stamped.taxCurrency).toBe("USD");
    expect(stamped.taxManualSource).toBe(STORED_TAX_ESTIMATE_SOURCE);
    expect(stamped.taxManualNote).toContain("Settings rate");
  });

  it("keeps a typed override instead of overwriting it with the estimate", () => {
    setAppSettingsCache(SETTINGS);
    const stamped = stampStoredLoadTax({
      ...HAWAII,
      taxManualAmount: "90",
      taxCurrency: "USD",
      taxManualSource: "Hawaii DOTAX GET schedule",
      taxManualNote: "Looked up on the authority page",
    });
    expect(stamped.taxManualAmount).toBe("90.00");
    expect(stamped.taxManualSource).toBe("Hawaii DOTAX GET schedule");
    expect(stamped.taxManualNote).toBe("Looked up on the authority page");
  });

  it("treats a blank source plus an amount as an override, not an estimator stamp", () => {
    setAppSettingsCache(SETTINGS);
    const stamped = stampStoredLoadTax({
      ...HAWAII,
      taxManualAmount: "50",
      taxCurrency: "USD",
      taxManualSource: "",
    });
    expect(stamped.taxManualAmount).toBe("50.00");
    expect(stamped.taxManualSource).toBe("manual");
  });

  it("recomputes when the previous save was an estimator stamp, so a rate edit does not leave stale tax", () => {
    setAppSettingsCache(SETTINGS);
    const stamped = stampStoredLoadTax({
      ...HAWAII,
      customerRate: "4800",
      taxManualAmount: "113.09",
      taxManualSource: STORED_TAX_ESTIMATE_SOURCE,
    });
    expect(stamped.taxManualAmount).toBe("226.18");
    expect(stamped.taxManualSource).toBe(STORED_TAX_ESTIMATE_SOURCE);
  });

  it("spreads onto a create payload", () => {
    setAppSettingsCache(SETTINGS);
    const payload = withStoredLoadTax({ ...HAWAII, loadId: "L-1" });
    expect(payload.loadId).toBe("L-1");
    expect(payload.taxManualAmount).toBe("113.09");
  });
});
