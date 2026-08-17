import { describe, expect, it } from "vitest";

import type { Role } from "@/lib/admin-user-constants";
import {
  LOAD_ECONOMIC_FIELDS,
  checkLoadCreate,
  checkLoadDelete,
  checkLoadUpdate,
} from "./load-permissions";
import type { TenantContext } from "./server-tenant-context";

function ctx(role: Role | null): TenantContext {
  return {
    userId: "user-1",
    role,
    companyId: "company-1",
    isTenantExempt: false,
    isPlatformAdmin: false,
    sessionEpoch: 1,
  };
}

const ALL_ROLES: Role[] = [
  "Organization Owner",
  "Admin",
  "SuperAdmin",
  "Operations Manager",
  "Broker",
  "Dispatcher",
  "Driver",
  "Accounting",
  "Sales",
  "Marketing",
];

describe("checkLoadUpdate — who may write a load at all", () => {
  it("refuses Sales and Marketing, the accounts that could silently rewrite rates", () => {
    // This is the hole: tenant isolation was solid, but inside a company every
    // authenticated user had the broker's power over pricing.
    for (const role of ["Sales", "Marketing"] as Role[]) {
      const check = checkLoadUpdate(
        ctx(role),
        { customerRate: "1.00" },
        { loadStatus: "in-transit" },
      );
      expect(check.ok, role).toBe(false);
      expect(check.ok === false && check.status, role).toBe(403);
      expect(check.ok === false && check.code, role).toBe("role_cannot_write_load");
    }
  });

  it("refuses a caller whose role never resolved", () => {
    // `buildTenantContext` sets role: null when neither the Cognito group nor
    // custom:role resolves. That is a denial, not a default.
    const check = checkLoadUpdate(ctx(null), { pickupCity: "Dallas" }, { loadStatus: "draft" });
    expect(check.ok).toBe(false);
    expect(check.ok === false && check.status).toBe(403);
  });

  it("refuses Driver on the company-scoped endpoint", () => {
    // Drivers have their own assignment-scoped endpoint. Reaching this one is a
    // routing bug, and it should not be a working one.
    const check = checkLoadUpdate(
      ctx("Driver"),
      { loadStatus: "delivered" },
      { loadStatus: "at-delivery" },
    );
    expect(check.ok).toBe(false);
  });

  it("lets dispatch move a load", () => {
    expect(
      checkLoadUpdate(ctx("Dispatcher"), { loadStatus: "dispatched" }, { loadStatus: "booked" }).ok,
    ).toBe(true);
  });
});

describe("checkLoadUpdate — who may price a load", () => {
  it("refuses Dispatcher, who moves trucks rather than setting rates", () => {
    const check = checkLoadUpdate(
      ctx("Dispatcher"),
      { customerRate: "2400.00" },
      { loadStatus: "booked" },
    );
    expect(check.ok).toBe(false);
    expect(check.ok === false && check.code).toBe("role_cannot_price_load");
    expect(check.ok === false && check.fields).toEqual(["customerRate"]);
  });

  it("refuses Accounting, whose corrections belong on the invoice", () => {
    // Accounting absolutely may fix money — via a credit memo on the invoice,
    // which leaves a trail. Not by quietly editing the load it derives from.
    const check = checkLoadUpdate(
      ctx("Accounting"),
      { linehaulRate: "1800" },
      { loadStatus: "delivered" },
    );
    expect(check.ok).toBe(false);
    expect(check.ok === false && check.code).toBe("role_cannot_price_load");
  });

  it("lets Broker and Operations Manager price", () => {
    for (const role of ["Broker", "Operations Manager"] as Role[]) {
      expect(
        checkLoadUpdate(ctx(role), { customerRate: "2400.00" }, { loadStatus: "booked" }).ok,
        role,
      ).toBe(true);
    }
  });

  it("names every economic field it refuses, not just the first", () => {
    const check = checkLoadUpdate(
      ctx("Dispatcher"),
      { customerRate: "1", fuelSurcharge: "2", pickupCity: "Dallas" },
      { loadStatus: "booked" },
    );
    expect(check.ok === false && check.fields).toEqual(["customerRate", "fuelSurcharge"]);
  });

  it("lets dispatch write operational fields on the same load it cannot price", () => {
    expect(
      checkLoadUpdate(ctx("Dispatcher"), { pickupCity: "Dallas" }, { loadStatus: "booked" }).ok,
    ).toBe(true);
  });

  it("treats payment terms as a price, because Net 15 and Net 60 are different money", () => {
    expect(LOAD_ECONOMIC_FIELDS.has("paymentTerms")).toBe(true);
    expect(
      checkLoadUpdate(ctx("Dispatcher"), { paymentTerms: "Net 90" }, { loadStatus: "booked" }).ok,
    ).toBe(false);
  });
});

describe("checkLoadUpdate — the load is evidence after delivery", () => {
  it("refuses a rate edit on a delivered load even from a broker", () => {
    const check = checkLoadUpdate(
      ctx("Broker"),
      { customerRate: "9999" },
      { loadStatus: "delivered" },
    );
    expect(check.ok).toBe(false);
    expect(check.ok === false && check.status).toBe(409);
    expect(check.ok === false && check.code).toBe("load_economically_frozen");
  });

  it("refuses editing a delivered load's reference numbers", () => {
    // Changing a BOL number weeks later is how an invoice stops reconciling.
    const check = checkLoadUpdate(
      ctx("Broker"),
      { deliveryReference: "BOL-999" },
      { loadStatus: "completed" },
    );
    expect(check.ok).toBe(false);
    expect(check.ok === false && check.code).toBe("load_economically_frozen");
  });

  it("refuses editing a delivered load's weight", () => {
    const check = checkLoadUpdate(ctx("Broker"), { weight: "1" }, { loadStatus: "pod-uploaded" });
    expect(check.ok).toBe(false);
  });

  it("still allows notes and documents on a delivered load", () => {
    // Freezing everything would stop POD upload and dispute notes, which is the
    // opposite of what the freeze is for.
    expect(
      checkLoadUpdate(ctx("Broker"), { internalNotes: "claim opened" }, { loadStatus: "delivered" })
        .ok,
    ).toBe(true);
    expect(
      checkLoadUpdate(ctx("Broker"), { documents: ["pod:signed.jpg"] }, { loadStatus: "delivered" })
        .ok,
    ).toBe(true);
  });

  it("answers on role before state, so a denial never implies the other check passed", () => {
    // Marketing editing a delivered load's rate hears "you cannot price loads",
    // not "this load is frozen" — the second would imply the first was fine.
    const check = checkLoadUpdate(
      ctx("Marketing"),
      { customerRate: "1" },
      { loadStatus: "delivered" },
    );
    expect(check.ok === false && check.code).toBe("role_cannot_write_load");
  });

  it("cannot be unfrozen by sending a status downgrade alongside the rate edit", () => {
    // The freeze reads the *stored* status, so including loadStatus: "draft" in
    // the same patch does not open the door.
    const check = checkLoadUpdate(
      ctx("Broker"),
      { loadStatus: "draft", customerRate: "1" },
      { loadStatus: "delivered" },
    );
    expect(check.ok).toBe(false);
    expect(check.ok === false && check.code).toBe("load_economically_frozen");
  });
});

describe("the freeze follows delivery, whichever field records it", () => {
  it("freezes a load the driver delivered even though loadStatus never advanced", () => {
    // Found in a live broker/driver run. The driver reports delivery by writing
    // `driverWorkflowStatus`; `loadStatus` only follows if something else writes
    // it. Keyed on loadStatus alone, the freeze did not engage — and a broker
    // rewrote a delivered load's rate to 9999 and its BOL number, both HTTP 200.
    const check = checkLoadUpdate(
      ctx("Broker"),
      { customerRate: "9999.00" },
      { loadStatus: "driver-assigned", driverWorkflowStatus: "delivered" },
    );
    expect(check.ok).toBe(false);
    expect(check.ok === false && check.code).toBe("load_economically_frozen");
  });

  it("freezes the reference numbers on that same load", () => {
    const check = checkLoadUpdate(
      ctx("Broker"),
      { deliveryReference: "BOL-999999" },
      { loadStatus: "driver-assigned", driverWorkflowStatus: "delivered" },
    );
    expect(check.ok).toBe(false);
  });

  it("freezes on pod-uploaded and completed workflow states too", () => {
    for (const workflow of ["pod-uploaded", "completed"]) {
      const check = checkLoadUpdate(
        ctx("Broker"),
        { customerRate: "1" },
        { loadStatus: "active", driverWorkflowStatus: workflow },
      );
      expect(check.ok, workflow).toBe(false);
    }
  });

  it("still freezes when only loadStatus knows about it", () => {
    // The dispatcher-driven path, where the board writes loadStatus and the
    // driver app never reported.
    const check = checkLoadUpdate(
      ctx("Broker"),
      { customerRate: "1" },
      { loadStatus: "delivered" },
    );
    expect(check.ok).toBe(false);
  });

  it("leaves a load mid-run editable", () => {
    expect(
      checkLoadUpdate(
        ctx("Broker"),
        { customerRate: "2900" },
        { loadStatus: "in-transit", driverWorkflowStatus: "en-route-delivery" },
      ).ok,
    ).toBe(true);
  });
});

describe("checkLoadCreate", () => {
  it("refuses read-only roles", () => {
    expect(checkLoadCreate(ctx("Sales"), { loadId: "L-1" }).ok).toBe(false);
    expect(checkLoadCreate(ctx("Marketing"), { loadId: "L-1" }).ok).toBe(false);
  });

  it("lets dispatch create a load but not price it", () => {
    expect(checkLoadCreate(ctx("Dispatcher"), { loadId: "L-1" }).ok).toBe(true);
    expect(checkLoadCreate(ctx("Dispatcher"), { loadId: "L-1", customerRate: "100" }).ok).toBe(
      false,
    );
  });
});

describe("checkLoadDelete", () => {
  it("is narrower than write — deleting destroys what an invoice was derived from", () => {
    expect(checkLoadDelete(ctx("Dispatcher")).ok).toBe(false);
    expect(checkLoadDelete(ctx("Broker")).ok).toBe(false);
    expect(checkLoadDelete(ctx("Admin")).ok).toBe(true);
    expect(checkLoadDelete(ctx("Organization Owner")).ok).toBe(true);
  });
});

describe("the three checks stay separate", () => {
  it("no role can price without being able to write", () => {
    for (const role of ALL_ROLES) {
      const canWrite = checkLoadUpdate(
        ctx(role),
        { pickupCity: "Dallas" },
        { loadStatus: "draft" },
      ).ok;
      const canPrice = checkLoadUpdate(
        ctx(role),
        { customerRate: "1" },
        { loadStatus: "draft" },
      ).ok;
      if (canPrice) expect(canWrite, `${role} prices but cannot write`).toBe(true);
    }
  });

  it("no role can delete without being able to write", () => {
    for (const role of ALL_ROLES) {
      const canWrite = checkLoadUpdate(
        ctx(role),
        { pickupCity: "Dallas" },
        { loadStatus: "draft" },
      ).ok;
      if (checkLoadDelete(ctx(role)).ok)
        expect(canWrite, `${role} deletes but cannot write`).toBe(true);
    }
  });
});
