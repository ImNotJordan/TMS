import { describe, expect, it } from "vitest";

import { buildLoadAuditEntry } from "./load-audit";
import type { TenantContext } from "./tenant/server-tenant-context";

function ctx(role: string | null = "Broker"): TenantContext {
  return {
    userId: "u-broker",
    role: role as TenantContext["role"],
    companyId: "co-titan",
    isTenantExempt: false,
    isPlatformAdmin: false,
    sessionEpoch: 1,
  };
}

const stored = {
  loadId: "L-1",
  loadStatus: "in-transit",
  customerRate: "2850.00",
  carrierRate: "2300.00",
  pickupCity: "Dallas",
};

describe("buildLoadAuditEntry", () => {
  it("records who changed a rate, and what it was before", () => {
    // Role checks stop a *disallowed* rate change. They leave no trace of an
    // allowed one — so after the fact you could say "that cannot have happened"
    // but never "here is what happened".
    const entry = buildLoadAuditEntry({
      ctx: ctx(),
      patch: { customerRate: "1900.00" },
      current: stored,
      via: "ops-api",
    });
    expect(entry).not.toBeNull();
    expect(entry!.by).toBe("u-broker");
    expect(entry!.role).toBe("Broker");
    expect(entry!.via).toBe("ops-api");
    expect(entry!.fields).toEqual(["customerRate"]);
    expect(entry!.rates).toEqual({ customerRate: { from: "2850.00", to: "1900.00" } });
  });

  it("keeps before/after for money and names-only for everything else", () => {
    // Recording every address edit in full would push the item toward Dynamo's
    // 400KB limit for no investigative benefit.
    const entry = buildLoadAuditEntry({
      ctx: ctx(),
      patch: { customerRate: "1900.00", pickupCity: "Fort Worth" },
      current: stored,
      via: "ops-api",
    });
    expect(entry!.fields).toEqual(["customerRate", "pickupCity"]);
    expect(Object.keys(entry!.rates!)).toEqual(["customerRate"]);
  });

  it("returns null when a resend changes nothing", () => {
    // Editor screens PUT whole records back. Without this, every save would log
    // forty unchanged fields and bury the one change that mattered.
    expect(
      buildLoadAuditEntry({
        ctx: ctx(),
        patch: { customerRate: "2850.00", pickupCity: "Dallas" },
        current: stored,
        via: "ops-api",
      }),
    ).toBeNull();
  });

  it("records a status move with both ends", () => {
    const entry = buildLoadAuditEntry({
      ctx: ctx(),
      patch: { loadStatus: "at-delivery" },
      current: stored,
      via: "ops-api",
    });
    expect(entry!.statusChange).toEqual({ from: "in-transit", to: "at-delivery" });
  });

  it("does not log its own trail, or high-churn telemetry", () => {
    // Auditing the audit trail is circular; a GPS ping every few minutes would
    // drown everything else.
    expect(
      buildLoadAuditEntry({
        ctx: ctx(),
        patch: { driverGps: { lat: 1, lng: 2 }, trackingSession: {}, loadAuditTrail: [] },
        current: stored,
        via: "driver-api",
      }),
    ).toBeNull();
  });

  it("records an unassigned role rather than omitting attribution", () => {
    const entry = buildLoadAuditEntry({
      ctx: ctx(null),
      patch: { pickupCity: "Waco" },
      current: stored,
      via: "ops-api",
    });
    expect(entry!.role).toBe("(unassigned)");
  });

  it("takes from-values from the stored record, not from the client", () => {
    // A client claiming the old rate was something else cannot rewrite history.
    const entry = buildLoadAuditEntry({
      ctx: ctx(),
      patch: { customerRate: "1900.00", carrierRate: "2300.00" },
      current: stored,
      via: "ops-api",
    });
    expect(entry!.rates!.customerRate.from).toBe("2850.00");
    // carrierRate was resent unchanged, so it is not a change at all.
    expect(entry!.fields).toEqual(["customerRate"]);
  });

  it("records a first-time value as from null", () => {
    const entry = buildLoadAuditEntry({
      ctx: ctx(),
      patch: { lumperFee: "125.00" },
      current: stored,
      via: "ops-api",
    });
    expect(entry!.rates).toEqual({ lumperFee: { from: null, to: "125.00" } });
  });
});
