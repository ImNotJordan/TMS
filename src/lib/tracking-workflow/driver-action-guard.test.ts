import { describe, expect, it } from "vitest";

import type { LoadRecord } from "../loads-store";
import {
  canApplyDriverAction,
  deriveTrackingStateFromLoad,
  getNextDriverActions,
  isTrackingSessionVisible,
  loadStatusForCloudWrite,
} from "./session-local";
import type { DriverWorkflowAction, TrackingSession, TrackingState } from "./types";

const ALL_STATES: TrackingState[] = [
  "waiting-driver",
  "driver-assigned",
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

const ALL_ACTIONS: DriverWorkflowAction[] = [
  "accept-load",
  "decline-load",
  "start-route-pickup",
  "arrived-pickup",
  "checkin-pickup",
  "loaded",
  "depart-pickup",
  "in-transit",
  "arrived-delivery",
  "checkin-delivery",
  "delivered",
  "upload-pod",
  "complete-load",
];

/** Higher = further along. Mirrors TRACKING_STATE_RANK. */
const RANK: Record<TrackingState, number> = {
  "waiting-driver": 0,
  "driver-assigned": 0.5,
  "driver-accepted": 1,
  "en-route-pickup": 2,
  "at-pickup": 3,
  "in-transit": 4,
  "at-delivery": 5,
  delivered: 6,
  "pod-uploaded": 7,
  completed: 8,
  exception: -1,
};

const STATE_BY_ACTION: Partial<Record<DriverWorkflowAction, TrackingState>> = {
  "accept-load": "driver-accepted",
  "start-route-pickup": "en-route-pickup",
  "arrived-pickup": "at-pickup",
  "checkin-pickup": "at-pickup",
  loaded: "at-pickup",
  "depart-pickup": "in-transit",
  "in-transit": "in-transit",
  "arrived-delivery": "at-delivery",
  "checkin-delivery": "at-delivery",
  delivered: "delivered",
  "upload-pod": "pod-uploaded",
  "complete-load": "completed",
};

describe("the state × action matrix", () => {
  it("classifies every one of the 143 cells", () => {
    const cells = ALL_STATES.flatMap((state) =>
      ALL_ACTIONS.map((action) => ({
        state,
        action,
        allowed: canApplyDriverAction(state, action),
      })),
    );
    expect(cells).toHaveLength(ALL_STATES.length * ALL_ACTIONS.length);
    // Every cell resolved to a boolean — no undefined behaviour anywhere.
    expect(cells.every((c) => typeof c.allowed === "boolean")).toBe(true);
  });

  it("never allows an action that walks the load backwards", () => {
    // The bug this file exists for: 120 of 130 cells used to apply, and 55 of
    // those moved the load to a *lower* rank. A dispatcher could put a completed
    // load back to "Driver Accepted".
    const regressions: string[] = [];
    for (const state of ALL_STATES) {
      for (const action of ALL_ACTIONS) {
        if (action === "decline-load") continue; // exception path, tested below
        if (!canApplyDriverAction(state, action)) continue;
        const to = STATE_BY_ACTION[action];
        if (to && RANK[to] < RANK[state]) regressions.push(`${state} --${action}--> ${to}`);
      }
    }
    expect(regressions).toEqual([]);
  });

  it("offers nothing from a terminal state", () => {
    expect(getNextDriverActions("completed")).toEqual([]);
    expect(getNextDriverActions("exception")).toEqual([]);
    for (const action of ALL_ACTIONS) {
      if (action === "decline-load") continue;
      expect(canApplyDriverAction("completed", action), `completed / ${action}`).toBe(false);
    }
  });

  it("refuses to climb out of exception without a reassignment", () => {
    for (const action of ALL_ACTIONS) {
      if (action === "decline-load") continue;
      expect(canApplyDriverAction("exception", action), `exception / ${action}`).toBe(false);
    }
  });

  it("keeps decline reachable from anywhere, because a load can hit trouble any time", () => {
    // `reportTrackingException` routes through decline-load. Exempting it is
    // deliberate, not an oversight in the guard.
    for (const state of ALL_STATES) {
      expect(canApplyDriverAction(state, "decline-load"), state).toBe(true);
    }
  });

  it("allows exactly the advertised action set, plus decline", () => {
    for (const state of ALL_STATES) {
      const advertised = new Set(getNextDriverActions(state));
      for (const action of ALL_ACTIONS) {
        const expected = action === "decline-load" ? true : advertised.has(action);
        expect(canApplyDriverAction(state, action), `${state} / ${action}`).toBe(expected);
      }
    }
  });

  it("allows the ordinary run start to finish", () => {
    const run: [TrackingState, DriverWorkflowAction][] = [
      ["driver-assigned", "accept-load"],
      ["driver-accepted", "start-route-pickup"],
      ["en-route-pickup", "arrived-pickup"],
      ["at-pickup", "loaded"],
      ["at-pickup", "depart-pickup"],
      ["in-transit", "arrived-delivery"],
      ["at-delivery", "delivered"],
      ["delivered", "upload-pod"],
      ["pod-uploaded", "complete-load"],
    ];
    for (const [state, action] of run) {
      expect(canApplyDriverAction(state, action), `${state} / ${action}`).toBe(true);
    }
  });
});

function load(overrides: Partial<LoadRecord> = {}): LoadRecord {
  return {
    loadId: "L-1001",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  } as LoadRecord;
}

describe("driver-assigned — the TODO: 'assigned loads still show Awaiting Driver'", () => {
  it("distinguishes a load with a driver on it from one with nobody", () => {
    // Both used to derive to waiting-driver and render "Waiting for Driver", so
    // dispatch could not tell which loads still needed chasing.
    expect(
      deriveTrackingStateFromLoad(
        load({ assignedDriver: "driver-9", loadStatus: "driver-assigned" }),
      ),
    ).toBe("driver-assigned");
    expect(deriveTrackingStateFromLoad(load({ loadStatus: "tendered" }))).toBe("waiting-driver");
  });

  it("still does not treat dispatch's own act as driver acceptance", () => {
    // The original reason those statuses were excluded, and it stays true.
    for (const loadStatus of ["driver-assigned", "active", "booked", "tendered"]) {
      const state = deriveTrackingStateFromLoad(load({ assignedDriver: "driver-9", loadStatus }));
      expect(state, loadStatus).not.toBe("driver-accepted");
      expect(state, loadStatus).toBe("driver-assigned");
    }
  });

  it("advances to driver-accepted the moment the portal reports acceptance", () => {
    expect(
      deriveTrackingStateFromLoad(
        load({
          assignedDriver: "driver-9",
          loadStatus: "driver-assigned",
          driverWorkflowStatus: "assigned",
        }),
      ),
    ).toBe("driver-accepted");
  });

  it("offers accept and decline from the new state", () => {
    expect(getNextDriverActions("driver-assigned")).toEqual(["accept-load", "decline-load"]);
  });
});

describe("history ordering is by server time, not the device clock", () => {
  it("reads the latest entry even when a wrong device clock appended out of order", () => {
    // A phone three hours behind appends an entry that sorts before the previous
    // one. Array position said "latest"; the device timestamp said otherwise.
    const state = deriveTrackingStateFromLoad(
      load({
        assignedDriver: "driver-9",
        loadStatus: "driver-assigned",
        driverStatusHistory: [
          {
            status: "at-pickup",
            at: "2026-08-01T09:00:00.000Z",
            serverAt: "2026-08-01T09:00:00.000Z",
          },
          // Device clock is hours behind; the server knows it arrived later.
          {
            status: "delivered",
            at: "2026-08-01T06:00:00.000Z",
            serverAt: "2026-08-01T11:00:00.000Z",
          },
        ],
      }),
    );
    expect(state).toBe("delivered");
  });

  it("falls back to the device timestamp on rows written before serverAt existed", () => {
    const state = deriveTrackingStateFromLoad(
      load({
        assignedDriver: "driver-9",
        loadStatus: "driver-assigned",
        driverStatusHistory: [
          { status: "assigned", at: "2026-08-01T01:00:00.000Z" },
          { status: "at-pickup", at: "2026-08-01T02:00:00.000Z" },
        ],
      }),
    );
    expect(state).toBe("at-pickup");
  });
});

describe("loadStatusForCloudWrite — a delivered load must reach the billing queue", () => {
  it("writes delivered through, which is what made loads billable", () => {
    // `writeSessionToLoad` only wrote trackingSession and driverWorkflowStatus, so
    // a load delivered on the tracking board kept its old loadStatus — and
    // `isLoadBillable` reads loadStatus.
    expect(loadStatusForCloudWrite("delivered", "in-transit")).toBe("delivered");
    expect(loadStatusForCloudWrite("at-delivery", "in-transit")).toBe("at-delivery");
  });

  it("never walks loadStatus backwards", () => {
    expect(loadStatusForCloudWrite("driver-accepted", "delivered")).toBeUndefined();
    expect(loadStatusForCloudWrite("at-pickup", "in-transit")).toBeUndefined();
  });

  it("writes nothing for states that describe dispatch rather than the run", () => {
    expect(loadStatusForCloudWrite("waiting-driver", "booked")).toBeUndefined();
    expect(loadStatusForCloudWrite("driver-assigned", "booked")).toBeUndefined();
    // An exception is not a lifecycle position and must not overwrite one.
    expect(loadStatusForCloudWrite("exception", "in-transit")).toBeUndefined();
  });

  it("writes nothing when the value already matches", () => {
    expect(loadStatusForCloudWrite("in-transit", "in-transit")).toBeUndefined();
    // Including via an alias of the stored spelling.
    expect(loadStatusForCloudWrite("in-transit", "en_route_delivery")).toBeUndefined();
  });

  it("never proposes a status the loads API would reject", () => {
    // If the board could write a status the transition table refuses, the write
    // would silently fail and the two views would diverge.
    expect(loadStatusForCloudWrite("delivered", "completed")).toBeUndefined();
    expect(loadStatusForCloudWrite("in-transit", "cancelled")).toBeUndefined();
  });
});

describe("a deep-linked load is shown however finished it is", () => {
  function session(over: Partial<TrackingSession> = {}): TrackingSession {
    return {
      loadId: "L-1001",
      trackingState: "completed",
      documents: [],
      ...over,
    } as TrackingSession;
  }

  it("hides a finished load from the board by default", () => {
    // The decluttering rule, unchanged: the live board shows trucks that move.
    expect(isTrackingSessionVisible(session({ trackingState: "completed" }))).toBe(false);
    expect(isTrackingSessionVisible(session({ trackingState: "delivered" }))).toBe(false);
  });

  it("shows it when it is the load that was explicitly asked for", () => {
    // Accounting's "Track" button only appears on invoice rows, an invoice only
    // exists for a delivered or completed load, and every one of those is hidden
    // by the rule above — so the button could never work. These filters are board
    // decluttering, not access control.
    expect(isTrackingSessionVisible(session({ trackingState: "completed" }), "L-1001")).toBe(true);
    expect(isTrackingSessionVisible(session({ trackingState: "delivered" }), "L-1001")).toBe(true);
  });

  it("does not un-hide every other finished load", () => {
    expect(isTrackingSessionVisible(session({ loadId: "L-OTHER" }), "L-1001")).toBe(false);
  });

  it("leaves a live load visible with or without a pin", () => {
    for (const pin of [undefined, null, "L-1001", "L-OTHER"]) {
      expect(isTrackingSessionVisible(session({ trackingState: "in-transit" }), pin)).toBe(true);
    }
  });
});
