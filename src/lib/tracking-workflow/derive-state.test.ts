import { describe, expect, it } from "vitest";

import type { LoadRecord } from "../loads-store";
import { deriveTrackingStateFromLoad, driverWorkflowForCloudWrite } from "./session-local";
import type { TrackingState } from "./types";

/** Mirrors apps/driver-portal `STATUS_STEPS` — the only values that app can parse. */
const DRIVER_PORTAL_STEPS = [
  "assigned",
  "en-route-pickup",
  "at-pickup",
  "loaded",
  "en-route-delivery",
  "at-delivery",
  "delivered",
];

function load(overrides: Partial<LoadRecord> = {}): LoadRecord {
  return {
    loadId: "L-1001",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    assignedDriver: "driver-9",
    ...overrides,
  } as LoadRecord;
}

describe("deriveTrackingStateFromLoad", () => {
  it("waits on the driver while only dispatch has acted", () => {
    expect(deriveTrackingStateFromLoad(load({ loadStatus: "driver-assigned" }))).toBe(
      "waiting-driver",
    );
    expect(deriveTrackingStateFromLoad(load({ loadStatus: "active" }))).toBe("waiting-driver");
  });

  it("advances as soon as the driver portal records an acceptance", () => {
    expect(
      deriveTrackingStateFromLoad(
        load({ loadStatus: "driver-assigned", driverWorkflowStatus: "assigned" }),
      ),
    ).toBe("driver-accepted");
  });

  it("honours a dispatcher-set load status when the driver app has not reported", () => {
    expect(deriveTrackingStateFromLoad(load({ loadStatus: "in-transit" }))).toBe("in-transit");
    expect(deriveTrackingStateFromLoad(load({ loadStatus: "dispatched" }))).toBe("en-route-pickup");
    expect(deriveTrackingStateFromLoad(load({ loadStatus: "at-delivery" }))).toBe("at-delivery");
  });

  it("lets the driver workflow win over a lagging load status", () => {
    expect(
      deriveTrackingStateFromLoad(
        load({ loadStatus: "driver-assigned", driverWorkflowStatus: "en-route-delivery" }),
      ),
    ).toBe("in-transit");
  });

  it("falls back to the latest status-history entry", () => {
    expect(
      deriveTrackingStateFromLoad(
        load({
          loadStatus: "driver-assigned",
          driverStatusHistory: [
            { status: "assigned", at: "2026-08-01T01:00:00.000Z" },
            { status: "at-pickup", at: "2026-08-01T02:00:00.000Z" },
          ],
        }),
      ),
    ).toBe("at-pickup");
  });

  it("raises an exception when the driver declines the assignment", () => {
    expect(
      deriveTrackingStateFromLoad(
        load({ loadStatus: "driver-assigned", driverWorkflowStatus: "declined" }),
      ),
    ).toBe("exception");
  });

  it("round-trips every driver step through tracking and back unchanged", () => {
    // The regression: ops wrote raw TrackingState into driverWorkflowStatus, the portal
    // failed to parse it, and the driver's status visibly reverted to "Assigned".
    for (const step of DRIVER_PORTAL_STEPS) {
      const state = deriveTrackingStateFromLoad(
        load({ loadStatus: "driver-assigned", driverWorkflowStatus: step }),
      );
      const written = driverWorkflowForCloudWrite(state, step);
      if (written !== undefined) {
        expect(DRIVER_PORTAL_STEPS, `${step} → ${state} → ${written}`).toContain(written);
      }
    }
  });

  it("keeps terminal states terminal", () => {
    expect(deriveTrackingStateFromLoad(load({ loadStatus: "completed" }))).toBe("completed");
    expect(deriveTrackingStateFromLoad(load({ loadStatus: "delivered" }))).toBe("delivered");
    expect(
      deriveTrackingStateFromLoad(load({ loadStatus: "delivered", documents: ["pod:signed.jpg"] })),
    ).toBe("pod-uploaded");
  });
});

describe("driverWorkflowForCloudWrite", () => {
  it("translates tracking vocabulary into the driver portal's", () => {
    expect(driverWorkflowForCloudWrite("driver-accepted", "assigned")).toBe("assigned");
    expect(driverWorkflowForCloudWrite("in-transit", "en-route-delivery")).toBe(
      "en-route-delivery",
    );
    expect(driverWorkflowForCloudWrite("at-delivery", "at-delivery")).toBe("at-delivery");
  });

  it("never writes a value the driver portal cannot parse", () => {
    const states: TrackingState[] = [
      "waiting-driver",
      "driver-accepted",
      "en-route-pickup",
      "at-pickup",
      "in-transit",
      "at-delivery",
      "delivered",
      "pod-uploaded",
      "completed",
      "exception",
    ];
    for (const state of states) {
      const written = driverWorkflowForCloudWrite(state, undefined);
      if (written === undefined) continue;
      expect([...DRIVER_PORTAL_STEPS, "pod-uploaded", "completed"], state).toContain(written);
    }
  });

  it("leaves the driver's own step alone when ops has nothing meaningful to say", () => {
    // Neither state describes something the driver reported.
    expect(driverWorkflowForCloudWrite("waiting-driver", "en-route-pickup")).toBeUndefined();
    expect(driverWorkflowForCloudWrite("exception", "at-pickup")).toBeUndefined();
  });

  it("refuses to walk the driver's progress backwards", () => {
    // Tracking collapses "loaded" into at-pickup; writing that back would demote them.
    expect(driverWorkflowForCloudWrite("at-pickup", "loaded")).toBeUndefined();
    expect(driverWorkflowForCloudWrite("driver-accepted", "at-delivery")).toBeUndefined();
  });

  it("still advances a load the dispatcher moved forward", () => {
    expect(driverWorkflowForCloudWrite("delivered", "at-delivery")).toBe("delivered");
    expect(driverWorkflowForCloudWrite("en-route-pickup", undefined)).toBe("en-route-pickup");
  });
});
