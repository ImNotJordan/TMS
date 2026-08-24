import { describe, expect, it } from "vitest";

import { retainMapsApiKey } from "./retain-maps-key";

describe("retainMapsApiKey", () => {
  it("adopts the first real key", () => {
    expect(retainMapsApiKey("", " AIza-company ")).toBe("AIza-company");
  });

  it("does not drop a working key when a poll omits maps", () => {
    expect(retainMapsApiKey("AIza-company", null)).toBe("AIza-company");
    expect(retainMapsApiKey("AIza-company", "")).toBe("AIza-company");
  });

  it("follows a key rotation from Settings", () => {
    expect(retainMapsApiKey("AIza-old", "AIza-new")).toBe("AIza-new");
  });
});
