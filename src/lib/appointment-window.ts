/**
 * On-time performance against the appointment window.
 *
 * ## Record, do not refuse
 *
 * A driver arriving outside their window is not an invalid request — it is Tuesday.
 * Refusing the status report would lose the event entirely and leave the board
 * showing a truck that never arrived, which is strictly worse than a late arrival
 * you can see. So nothing here blocks a write.
 *
 * What was missing is that nothing *noticed*. A driver reported `at-pickup` a day
 * before the window opened and `delivered` two days before its appointment, and
 * both were accepted silently. Every number a shipper argues with — on-time
 * percentage, detention, late fees — is computed off those timestamps, so until the
 * variance is recorded, none of those figures are defensible.
 *
 * ## Free time starts at the later of arrival and window open
 *
 * A driver who shows up two hours early does not start the detention clock two
 * hours early; the shipper is not liable for time before their own window. That is
 * the rule `detentionClockStart` implements. It is a commercial term rather than a
 * technical one — see NOTES.md Q4 — and it lives here so there is one place to
 * change it if a customer's contract says otherwise.
 */

/** Which end of the run a status report refers to. */
export type AppointmentLeg = "pickup" | "delivery";

export type AppointmentWindow = {
  /** ISO 8601, ideally with an offset. */
  start?: string;
  end?: string;
};

export type WindowVariance = {
  leg: AppointmentLeg;
  /**
   * Minutes relative to the window. Negative = arrived before it opened,
   * positive = after it closed, 0 = inside it.
   */
  varianceMinutes: number;
  onTime: boolean;
  /** Absent when the load carries no window to measure against. */
  window: AppointmentWindow;
};

function parse(iso: string | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

const MINUTE = 60_000;

/**
 * How far outside its appointment window a report landed.
 *
 * Returns `null` when there is nothing to measure — no window on the load, or an
 * unparseable one. A missing window is a data-quality problem (see NOTES.md G21),
 * not a service failure, and reporting it as "0 minutes, on time" would launder it
 * into a clean on-time statistic.
 */
export function windowVariance(
  leg: AppointmentLeg,
  window: AppointmentWindow,
  reportedAtIso: string,
): WindowVariance | null {
  const at = parse(reportedAtIso);
  if (at === null) return null;

  const start = parse(window.start);
  const end = parse(window.end);
  if (start === null && end === null) return null;

  // Outside the window in either direction; inside is exactly zero.
  let varianceMinutes = 0;
  if (start !== null && at < start) varianceMinutes = Math.round((at - start) / MINUTE);
  else if (end !== null && at > end) varianceMinutes = Math.round((at - end) / MINUTE);

  return { leg, window, varianceMinutes, onTime: varianceMinutes === 0 };
}

/**
 * When the detention clock starts: the later of arrival and the window opening.
 *
 * Returns the arrival time unchanged when there is no window to compare against —
 * with nothing scheduled, the only defensible start is when the truck actually got
 * there.
 */
export function detentionClockStart(
  window: AppointmentWindow,
  arrivedAtIso: string,
): string | null {
  const arrived = parse(arrivedAtIso);
  if (arrived === null) return null;
  const start = parse(window.start);
  if (start === null) return new Date(arrived).toISOString();
  return new Date(Math.max(arrived, start)).toISOString();
}

/** The window for a leg, read off a load record's flat fields. */
export function windowForLeg(
  leg: AppointmentLeg,
  load: {
    pickupWindowStart?: string;
    pickupWindowEnd?: string;
    deliveryWindowStart?: string;
    deliveryWindowEnd?: string;
  },
): AppointmentWindow {
  return leg === "pickup"
    ? { start: load.pickupWindowStart, end: load.pickupWindowEnd }
    : { start: load.deliveryWindowStart, end: load.deliveryWindowEnd };
}

/**
 * The leg a driver step reports against, or `null` for steps that are neither an
 * arrival nor a delivery and so have no window to measure.
 */
export function legForDriverStep(step: string | null | undefined): AppointmentLeg | null {
  switch ((step ?? "").trim().toLowerCase()) {
    case "at-pickup":
    case "loaded":
      return "pickup";
    case "at-delivery":
    case "delivered":
      return "delivery";
    default:
      return null;
  }
}
