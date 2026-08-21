import { describe, expect, it } from "vitest";

import { resolveAppAudience } from "./auth-roles";

describe("resolveAppAudience", () => {
  it("routes a Client storage-key to the customer portal", () => {
    expect(resolveAppAudience({ "custom:role": "client" })).toBe("client");
  });

  it("keeps staff on the operations console even if they are also tagged client", () => {
    expect(resolveAppAudience({ "custom:role": "admin client" })).toBe("ops");
  });

  it("keeps dedicated drivers on the driver app", () => {
    expect(resolveAppAudience({ "custom:role": "driver" })).toBe("driver");
  });

  it("stays unknown when the pool has no role attribute yet", () => {
    expect(resolveAppAudience({})).toBe("unknown");
  });
});
