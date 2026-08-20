/** Shared GPS ping shape stored on Loads for Tracking Map. */

export type DriverGpsPing = {
  lat: number;
  lng: number;
  accuracyM?: number;
  speedMph?: number;
  headingDeg?: number;
  /** Device clock. Kept as reported — evidence, not an ordering key. */
  lastPingAt: string;
  /** When the server accepted the ping. Stamped by `driver-loads-proxy`. */
  serverAt?: string;
  sharedBy?: string;
  sharedByName?: string;
};

/**
 * Positions this inaccurate must not drive automatic decisions.
 *
 * A cold GPS fix indoors routinely reports several hundred metres of error. Using
 * one to decide that a truck arrived puts a false arrival on the customer's
 * tracking page and starts detention that nobody owes.
 */
export const GPS_DECISION_ACCURACY_LIMIT_M = 100;

/**
 * Is this ping precise enough to base an arrival or departure on?
 *
 * A ping with no `accuracyM` at all is treated as usable: the field is newer than
 * the data, and refusing every historical ping would take working loads off the
 * board. A ping that *reports* poor accuracy is refused.
 */
export function isGpsAccurateEnoughForDecisions(
  ping: Pick<DriverGpsPing, "accuracyM"> | undefined | null,
): boolean {
  if (!ping) return false;
  if (ping.accuracyM == null) return true;
  return Number.isFinite(ping.accuracyM) && ping.accuracyM <= GPS_DECISION_ACCURACY_LIMIT_M;
}

export const DRIVER_GPS_SHARE_INTERVAL_MS = 10 * 60 * 1000;

/** Prefer live driver GPS over simulated ticks while the ping is reasonably fresh. */
export const DRIVER_GPS_FRESH_MS = 15 * 60 * 1000;

export function isDriverGpsFresh(
  ping: DriverGpsPing | undefined | null,
  now = Date.now(),
): boolean {
  if (!ping) return false;
  if (!Number.isFinite(ping.lat) || !Number.isFinite(ping.lng)) return false;
  if (ping.lat === 0 && ping.lng === 0) return false;
  const at = Date.parse(ping.lastPingAt);
  if (!Number.isFinite(at)) return false;
  return now - at <= DRIVER_GPS_FRESH_MS;
}
