import { describe, expect, it } from "vitest";

import { reconcileRecord } from "./record-freshness";

const T1 = "2026-08-07T10:00:00.000Z";
const T2 = "2026-08-07T10:00:05.000Z";
const T3 = "2026-08-07T10:00:09.000Z";

type Row = { loadId: string; updatedAt: string; driverWorkflowStatus?: string };

const row = (updatedAt: string, driverWorkflowStatus?: string): Row => ({
  loadId: "L-1001",
  updatedAt,
  driverWorkflowStatus,
});

describe("reconcileRecord", () => {
  it("passes reads through untouched when nothing is pending", () => {
    const incoming = row(T1, "assigned");
    expect(reconcileRecord(incoming, undefined)).toEqual({ record: incoming, settled: true });
  });

  it("keeps the local write when the scan returns a pre-write item", () => {
    // The exact regression: driver taps "En route to pickup", an in-flight poll lands
    // holding the accept-era record, and the UI snaps back to "Assigned".
    const stale = row(T1, "assigned");
    const mine = row(T2, "en-route-pickup");
    const { record, settled } = reconcileRecord(stale, mine);
    expect(record.driverWorkflowStatus).toBe("en-route-pickup");
    expect(settled).toBe(false);
  });

  it("settles once the backend echoes our own write back", () => {
    const mine = row(T2, "en-route-pickup");
    const { record, settled } = reconcileRecord(row(T2, "en-route-pickup"), mine);
    expect(record.driverWorkflowStatus).toBe("en-route-pickup");
    expect(settled).toBe(true);
  });

  it("yields to a newer write from somewhere else", () => {
    // Ops console or a second device moved the load on — that must win, not our echo.
    const mine = row(T2, "en-route-pickup");
    const { record, settled } = reconcileRecord(row(T3, "at-pickup"), mine);
    expect(record.driverWorkflowStatus).toBe("at-pickup");
    expect(settled).toBe(true);
  });

  it("does not strand a pending write when the read has no timestamp", () => {
    const mine = row(T2, "en-route-pickup");
    const { record, settled } = reconcileRecord({ loadId: "L-1001" } as unknown as Row, mine);
    expect(record.driverWorkflowStatus).toBe("en-route-pickup");
    expect(settled).toBe(false);
  });
});
