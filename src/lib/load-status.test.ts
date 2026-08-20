import { describe, expect, it } from "vitest";

import {
  ALLOWED_TRANSITIONS,
  LOAD_STATUSES,
  checkLoadTransition,
  isEconomicallyFrozen,
  normalizeLoadStatus,
  type LoadStatus,
} from "./load-status";

describe("normalizeLoadStatus", () => {
  it("folds the capitalised value Quotes used to write", () => {
    // The load board only worked because every reader lowercased first. One
    // reader that forgot would have broken quote-originated loads alone.
    expect(normalizeLoadStatus("Booked")).toBe("booked");
    expect(normalizeLoadStatus("  DELIVERED ")).toBe("delivered");
  });

  it("folds the underscore and en-dash spellings found in stored records", () => {
    expect(normalizeLoadStatus("en_route_delivery")).toBe("in-transit");
    expect(normalizeLoadStatus("en-route-delivery")).toBe("in-transit");
    expect(normalizeLoadStatus("at_pickup")).toBe("at-pickup");
    expect(normalizeLoadStatus("canceled")).toBe("cancelled");
  });

  it("refuses a value that is not a load status", () => {
    expect(normalizeLoadStatus("totally-invented")).toBeNull();
    expect(normalizeLoadStatus("")).toBeNull();
    expect(normalizeLoadStatus(undefined)).toBeNull();
    expect(normalizeLoadStatus(null)).toBeNull();
  });

  it("does not default a missing status to draft", () => {
    // A load with no status is a data problem. Defaulting would hide it.
    expect(normalizeLoadStatus(undefined)).not.toBe("draft");
  });

  it("is idempotent over every canonical value", () => {
    for (const status of LOAD_STATUSES) {
      expect(normalizeLoadStatus(status)).toBe(status);
    }
  });
});

describe("checkLoadTransition", () => {
  it("refuses the jump that let a load be invoiced without being picked up", () => {
    const check = checkLoadTransition("draft", "delivered");
    expect(check.ok).toBe(false);
    expect(check.ok === false && check.code).toBe("illegal_transition");
  });

  it("refuses walking a delivered load back to draft", () => {
    const check = checkLoadTransition("delivered", "draft");
    expect(check.ok).toBe(false);
    expect(check.ok === false && check.code).toBe("illegal_transition");
  });

  it("refuses an invented status outright", () => {
    const check = checkLoadTransition("draft", "totally-invented");
    expect(check.ok).toBe(false);
    expect(check.ok === false && check.code).toBe("unknown_status");
  });

  it("refuses any change to a completed or cancelled load", () => {
    for (const terminal of ["completed", "cancelled"] as const) {
      const check = checkLoadTransition(terminal, "draft");
      expect(check.ok, terminal).toBe(false);
      expect(check.ok === false && check.code, terminal).toBe("load_terminal");
    }
  });

  it("allows a no-op so whole-record editor saves keep working", () => {
    // Editor screens PUT the whole record back, including an unchanged status.
    expect(checkLoadTransition("in-transit", "in-transit").ok).toBe(true);
    // Including when the client's copy is an alias of what is stored.
    expect(checkLoadTransition("in-transit", "en_route_delivery").ok).toBe(true);
  });

  it("allows the ordinary forward path end to end", () => {
    const path: LoadStatus[] = [
      "draft",
      "tendered",
      "booked",
      "driver-assigned",
      "dispatched",
      "at-pickup",
      "loaded",
      "in-transit",
      "at-delivery",
      "delivered",
      "pod-uploaded",
      "completed",
    ];
    for (let i = 0; i < path.length - 1; i += 1) {
      const check = checkLoadTransition(path[i], path[i + 1]);
      expect(check.ok, `${path[i]} → ${path[i + 1]}`).toBe(true);
    }
  });

  it("allows cancelling before the freight is loaded and not after", () => {
    expect(checkLoadTransition("booked", "cancelled").ok).toBe(true);
    expect(checkLoadTransition("at-pickup", "cancelled").ok).toBe(true);
    // Once it is on the trailer this is a TONU or an exception, not a cancel.
    expect(checkLoadTransition("loaded", "cancelled").ok).toBe(false);
    expect(checkLoadTransition("in-transit", "cancelled").ok).toBe(false);
  });

  it("lets any live load be flagged as an exception, and back out only to the start", () => {
    expect(checkLoadTransition("in-transit", "exception").ok).toBe(true);
    expect(checkLoadTransition("delivered", "exception").ok).toBe(true);
    expect(checkLoadTransition("exception", "booked").ok).toBe(true);
    // Not straight back into the middle of a run it may no longer be on.
    expect(checkLoadTransition("exception", "in-transit").ok).toBe(false);
  });

  it("lets a record written before this table existed start anywhere reachable from draft", () => {
    expect(checkLoadTransition(undefined, "tendered").ok).toBe(true);
    expect(checkLoadTransition(undefined, "draft").ok).toBe(true);
    // But not straight to delivered — that is the same hole by another route.
    expect(checkLoadTransition(undefined, "delivered").ok).toBe(false);
  });

  it("cannot reopen a load as a draft once a carrier is on it", () => {
    // Un-tendering back to draft is legitimate: it went out, nobody took it, you
    // pull it back to edit. Reopening a *booked* load as a draft is not — it would
    // strip a load with a committed carrier off every board at once.
    const reopenable: string[] = ["draft", "tendered", "exception"];
    for (const from of LOAD_STATUSES) {
      if (reopenable.includes(from)) continue;
      expect(ALLOWED_TRANSITIONS[from].has("draft"), `${from} → draft`).toBe(false);
    }
    expect(ALLOWED_TRANSITIONS.tendered.has("draft")).toBe(true);
  });

  it("allows the shortcuts a real driver takes, and no others", () => {
    // Forgot to tap "arrived": the delivery still has to land, because refusing
    // it loses the POD event.
    expect(checkLoadTransition("in-transit", "delivered").ok).toBe(true);
    // Departed pickup without a separate "loaded" tap — the normal tracking path.
    expect(checkLoadTransition("at-pickup", "in-transit").ok).toBe(true);
    // But not skipping the whole run.
    expect(checkLoadTransition("booked", "delivered").ok).toBe(false);
    expect(checkLoadTransition("at-pickup", "completed").ok).toBe(false);
  });

  it("leaves no status stranded — every non-terminal one can still move", () => {
    for (const from of LOAD_STATUSES) {
      if (from === "completed" || from === "cancelled") continue;
      expect(ALLOWED_TRANSITIONS[from].size, `${from} has no exits`).toBeGreaterThan(0);
    }
  });
});

describe("isEconomicallyFrozen", () => {
  it("freezes from delivery onward", () => {
    expect(isEconomicallyFrozen("delivered")).toBe(true);
    expect(isEconomicallyFrozen("pod-uploaded")).toBe(true);
    expect(isEconomicallyFrozen("completed")).toBe(true);
  });

  it("leaves a live load editable", () => {
    expect(isEconomicallyFrozen("draft")).toBe(false);
    expect(isEconomicallyFrozen("in-transit")).toBe(false);
    expect(isEconomicallyFrozen("at-delivery")).toBe(false);
  });

  it("treats an unknown or absent status as not frozen", () => {
    // Fail open here on purpose: the write itself is refused upstream by
    // `canonicalStatusFromBody`, and freezing on an unparseable value would
    // strand legacy records with no way to correct them.
    expect(isEconomicallyFrozen(undefined)).toBe(false);
    expect(isEconomicallyFrozen("nonsense")).toBe(false);
  });
});
