import { describe, expect, it } from "vitest";

import { resolveIntegrationState } from "./resolveIntegration";

describe("resolveIntegrationState DAT flags", () => {
  it("drops rate capability when DAT rate data is disabled", () => {
    const state = resolveIntegrationState("dat", {
      dat_api_key: "live-key-1234",
      enable_dat_rate_data: false,
      enable_dat_capacity_data: true,
    });
    expect(state.capabilities).toEqual(["dat.capacity"]);
    expect(state.status).toBe("connected");
  });

  it("disconnects DAT when both data toggles are off, even with a key", () => {
    const state = resolveIntegrationState("dat", {
      dat_api_key: "live-key-1234",
      enable_dat_rate_data: false,
      enable_dat_capacity_data: false,
    });
    expect(state.status).toBe("disconnected");
    expect(state.capabilities).toEqual([]);
  });
});
