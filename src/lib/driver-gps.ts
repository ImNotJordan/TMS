/** Shared GPS ping shape stored on Loads for Tracking Map. */

export type DriverGpsPing = {
  lat: number;
  lng: number;
  accuracyM?: number;
  speedMph?: number;
  headingDeg?: number;
  lastPingAt: string;
  sharedBy?: string;
  sharedByName?: string;
};

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
