import { describe, expect, it } from "vitest";

import {
  isClientActiveLoad,
  loadBelongsToAssignedCustomers,
  parseAssignedCustomers,
  refuseClientOnOpsApi,
} from "./client-scope";
import type { TenantContext } from "./server-tenant-context";

describe("parseAssignedCustomers", () => {
  it("splits comma, semicolon and newline lists and trims", () => {
    expect(parseAssignedCustomers("Acme, Beta Co;\nGamma")).toEqual(["Acme", "Beta Co", "Gamma"]);
  });

  it("dedupes case-insensitively but keeps the first spelling", () => {
    expect(parseAssignedCustomers("Acme, acme, ACME")).toEqual(["Acme"]);
  });

  it("accepts an array and ignores blank entries", () => {
    expect(parseAssignedCustomers([" Acme ", "", "Beta"])).toEqual(["Acme", "Beta"]);
  });

  it("returns empty for missing or unusable values", () => {
    expect(parseAssignedCustomers(undefined)).toEqual([]);
    expect(parseAssignedCustomers(null)).toEqual([]);
    expect(parseAssignedCustomers(12)).toEqual([]);
    expect(parseAssignedCustomers("  , ; ")).toEqual([]);
  });
});

describe("loadBelongsToAssignedCustomers", () => {
  it("matches exactly, ignoring case and surrounding space", () => {
    expect(loadBelongsToAssignedCustomers("  ACME  ", ["Acme"])).toBe(true);
    expect(loadBelongsToAssignedCustomers("Acme West", ["Acme"])).toBe(false);
  });

  it("fails closed when nothing is assigned or the load has no customer", () => {
    expect(loadBelongsToAssignedCustomers("Acme", [])).toBe(false);
    expect(loadBelongsToAssignedCustomers("", ["Acme"])).toBe(false);
    expect(loadBelongsToAssignedCustomers(undefined, ["Acme"])).toBe(false);
  });
});

describe("isClientActiveLoad", () => {
  it("keeps in-flight statuses and drops paperwork and terminals", () => {
    expect(isClientActiveLoad({ loadStatus: "in-transit" })).toBe(true);
    expect(isClientActiveLoad({ loadStatus: "booked" })).toBe(true);
    expect(isClientActiveLoad({ loadStatus: "draft" })).toBe(false);
    expect(isClientActiveLoad({ loadStatus: "cancelled" })).toBe(false);
    expect(isClientActiveLoad({ loadStatus: "completed" })).toBe(false);
  });

  it("treats driver-reported delivery as no longer active even if loadStatus lags", () => {
    expect(
      isClientActiveLoad({ loadStatus: "driver-assigned", driverWorkflowStatus: "delivered" }),
    ).toBe(false);
  });
});

describe("refuseClientOnOpsApi", () => {
  const ctx = (role: TenantContext["role"]): TenantContext => ({
    userId: "u1",
    role,
    companyId: "c1",
    isTenantExempt: false,
    isPlatformAdmin: false,
    sessionEpoch: null,
  });

  it("blocks Client and lets staff through", async () => {
    const blocked = refuseClientOnOpsApi(ctx("Client"), "/api/loads");
    expect(blocked?.status).toBe(403);
    expect(await blocked?.json()).toMatchObject({ code: "client_audience" });
    expect(refuseClientOnOpsApi(ctx("Dispatcher"), "/api/loads")).toBeNull();
  });
});
