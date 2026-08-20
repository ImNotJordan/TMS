import { describe, expect, it } from "vitest";

import {
  detentionClockStart,
  legForDriverStep,
  windowForLeg,
  windowVariance,
} from "./appointment-window";

const WINDOW = { start: "2026-08-16T06:00:00-05:00", end: "2026-08-16T07:00:00-05:00" };

describe("windowVariance", () => {
  it("reports zero inside the window", () => {
    const v = windowVariance("delivery", WINDOW, "2026-08-16T06:30:00-05:00");
    expect(v?.varianceMinutes).toBe(0);
    expect(v?.onTime).toBe(true);
  });

  it("reports the boundaries as on time", () => {
    // A truck at the second the window opens is on time, not one minute early.
    expect(windowVariance("delivery", WINDOW, "2026-08-16T06:00:00-05:00")?.onTime).toBe(true);
    expect(windowVariance("delivery", WINDOW, "2026-08-16T07:00:00-05:00")?.onTime).toBe(true);
  });

  it("reports arriving before the window as negative minutes", () => {
    const v = windowVariance("delivery", WINDOW, "2026-08-16T04:30:00-05:00");
    expect(v?.varianceMinutes).toBe(-90);
    expect(v?.onTime).toBe(false);
  });

  it("reports arriving after the window as positive minutes", () => {
    const v = windowVariance("delivery", WINDOW, "2026-08-16T09:15:00-05:00");
    expect(v?.varianceMinutes).toBe(135);
    expect(v?.onTime).toBe(false);
  });

  it("catches the case a driver actually hit: delivered two days early", () => {
    // Reported delivered on the 14th against a window on the 16th, and nothing
    // noticed. On-time percentage and late fees are computed off this.
    const v = windowVariance("delivery", WINDOW, "2026-08-14T16:23:00-05:00");
    expect(v?.onTime).toBe(false);
    expect(v?.varianceMinutes).toBe(-2257);
  });

  it("returns null when the load carries no window", () => {
    // Not "0 minutes, on time" — that would launder a missing appointment into a
    // clean on-time statistic.
    expect(windowVariance("pickup", {}, "2026-08-16T06:30:00-05:00")).toBeNull();
    expect(windowVariance("pickup", { start: "not a date" }, "2026-08-16T06:30:00Z")).toBeNull();
  });

  it("returns null for an unparseable report time", () => {
    expect(windowVariance("delivery", WINDOW, "yesterday")).toBeNull();
  });

  it("measures against an open-ended window", () => {
    expect(
      windowVariance("pickup", { start: WINDOW.start }, "2026-08-16T05:00:00-05:00")
        ?.varianceMinutes,
    ).toBe(-60);
    // Nothing can be late against a window with no close.
    expect(
      windowVariance("pickup", { start: WINDOW.start }, "2026-08-16T23:00:00-05:00")?.onTime,
    ).toBe(true);
  });

  it("compares instants, so offsets do not shift the answer", () => {
    // 07:00-05:00 and 12:00Z are the same moment.
    expect(windowVariance("delivery", WINDOW, "2026-08-16T12:00:00Z")?.onTime).toBe(true);
  });
});

describe("detentionClockStart", () => {
  it("starts at window open when the driver arrives early", () => {
    // The shipper is not liable for a truck that shows up two hours early.
    expect(detentionClockStart(WINDOW, "2026-08-16T04:00:00-05:00")).toBe(
      new Date("2026-08-16T06:00:00-05:00").toISOString(),
    );
  });

  it("starts at arrival when the driver arrives inside or after the window", () => {
    expect(detentionClockStart(WINDOW, "2026-08-16T06:30:00-05:00")).toBe(
      new Date("2026-08-16T06:30:00-05:00").toISOString(),
    );
    expect(detentionClockStart(WINDOW, "2026-08-16T09:00:00-05:00")).toBe(
      new Date("2026-08-16T09:00:00-05:00").toISOString(),
    );
  });

  it("falls back to arrival with no window scheduled", () => {
    expect(detentionClockStart({}, "2026-08-16T09:00:00-05:00")).toBe(
      new Date("2026-08-16T09:00:00-05:00").toISOString(),
    );
  });
});

describe("legForDriverStep", () => {
  it("maps the steps that happen at a dock", () => {
    expect(legForDriverStep("at-pickup")).toBe("pickup");
    expect(legForDriverStep("loaded")).toBe("pickup");
    expect(legForDriverStep("at-delivery")).toBe("delivery");
    expect(legForDriverStep("delivered")).toBe("delivery");
  });

  it("has no leg for steps that happen on the road", () => {
    // Nothing to measure: there is no appointment for "departing".
    for (const step of ["assigned", "en-route-pickup", "en-route-delivery", "declined", ""]) {
      expect(legForDriverStep(step), step).toBeNull();
    }
  });
});

describe("windowForLeg", () => {
  it("reads the flat fields off a load", () => {
    const load = {
      pickupWindowStart: "a",
      pickupWindowEnd: "b",
      deliveryWindowStart: "c",
      deliveryWindowEnd: "d",
    };
    expect(windowForLeg("pickup", load)).toEqual({ start: "a", end: "b" });
    expect(windowForLeg("delivery", load)).toEqual({ start: "c", end: "d" });
  });
});
