import { describe, expect, it } from "vitest";

import type { DriverLoadRecord } from "./aws-loads";
import { mapLoadRecordToPortalLoad } from "./load-mapper";

/** Cognito sub. Identity is the sub — not the email, not the display name. */
const DRIVER_ID = "driver-9";

function record(overrides: Partial<DriverLoadRecord> = {}): DriverLoadRecord {
  return {
    loadId: "L-1001",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    pickupCity: "Dallas",
    pickupState: "TX",
    deliveryCity: "Memphis",
    deliveryState: "TN",
    ...overrides,
  };
}

function statusOf(overrides: Partial<DriverLoadRecord>) {
  return mapLoadRecordToPortalLoad(record(overrides), DRIVER_ID, new Set())?.status;
}

describe("resolvePortalStatus — dispatcher assignment handshake", () => {
  it("treats a bare dispatcher assignment as an offer awaiting acceptance", () => {
    const load = mapLoadRecordToPortalLoad(
      record({ assignedDriver: "driver-9", loadStatus: "driver-assigned" }),
      DRIVER_ID,
      new Set(),
    );
    // Not "assigned": accepting is what writes driverWorkflowStatus back to Dynamo,
    // which is the only thing that moves ops Tracking off "Waiting for Driver".
    expect(load?.status).toBe("offered");
    expect(load?.assignedByDispatch).toBe(true);
  });

  it("reports assigned once the driver has accepted in the portal", () => {
    const load = mapLoadRecordToPortalLoad(
      record({
        assignedDriver: "driver-9",
        loadStatus: "driver-assigned",
        driverWorkflowStatus: "assigned",
      }),
      DRIVER_ID,
      new Set(),
    );
    expect(load?.status).toBe("assigned");
    expect(load?.assignedByDispatch).toBe(false);
  });

  it("does not re-prompt for acceptance once status history exists", () => {
    expect(
      statusOf({
        assignedDriver: "driver-9",
        loadStatus: "driver-assigned",
        driverStatusHistory: [{ status: "assigned", at: "2026-08-01T01:00:00.000Z" }],
      }),
    ).toBe("assigned");
  });

  it("keeps driver progress recorded on loadStatus alone", () => {
    expect(statusOf({ assignedDriver: "driver-9", loadStatus: "in-transit" })).toBe(
      "en-route-delivery",
    );
    expect(statusOf({ assignedDriver: "driver-9", loadStatus: "at-pickup" })).toBe("at-pickup");
  });

  it("persists a decline on the record so it survives a device change", () => {
    expect(
      statusOf({
        assignedDriver: "driver-9",
        loadStatus: "driver-assigned",
        driverWorkflowStatus: "declined",
      }),
    ).toBe("declined");
  });

  it("still marks unassigned marketplace freight as an open offer", () => {
    const load = mapLoadRecordToPortalLoad(
      record({ loadStatus: "tendered" }),
      DRIVER_ID,
      new Set(),
    );
    expect(load?.status).toBe("offered");
    expect(load?.assignedByDispatch).toBe(false);
  });

  it("understands the ops console's tracking vocabulary", () => {
    // The ops write-through stamps TrackingState names into driverWorkflowStatus.
    // Before this was mapped, none of these parsed and every one fell back to
    // "assigned" — the driver watched their progress revert on reload.
    const cases: Array<[string, string]> = [
      ["driver-accepted", "assigned"],
      ["accepted", "assigned"],
      ["in-transit", "en-route-delivery"],
      ["at-delivery", "at-delivery"],
      ["pod-uploaded", "delivered"],
      ["completed", "delivered"],
    ];
    for (const [workflow, expected] of cases) {
      expect(
        statusOf({
          assignedDriver: "driver-9",
          loadStatus: "driver-assigned",
          driverWorkflowStatus: workflow,
        }),
        workflow,
      ).toBe(expected);
    }
  });

  it("treats the ops 'waiting-driver' placeholder as not-yet-accepted", () => {
    // Ops saying it is waiting on the driver is the opposite of an acknowledgement,
    // so the load must go back to needing an Accept rather than reading as active.
    expect(
      statusOf({
        assignedDriver: "driver-9",
        loadStatus: "driver-assigned",
        driverWorkflowStatus: "waiting-driver",
      }),
    ).toBe("offered");
  });

  it("keeps the driver's own step when it survives the round trip", () => {
    for (const step of [
      "en-route-pickup",
      "at-pickup",
      "loaded",
      "en-route-delivery",
      "delivered",
    ]) {
      expect(
        statusOf({
          assignedDriver: "driver-9",
          loadStatus: "driver-assigned",
          driverWorkflowStatus: step,
        }),
        step,
      ).toBe(step);
    }
  });

  it("ignores loads assigned to a different driver", () => {
    expect(
      mapLoadRecordToPortalLoad(
        record({ assignedDriver: "driver-42", loadStatus: "driver-assigned" }),
        DRIVER_ID,
        new Set(),
      ),
    ).toBeNull();
  });
});
