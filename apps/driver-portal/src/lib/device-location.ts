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

/** Share interval requested by ops Tracking Map. */
export const DRIVER_GPS_SHARE_INTERVAL_MS = 10 * 60 * 1000;

export type LocationPermissionState = "prompt" | "granted" | "denied" | "unsupported";

export function isGeolocationSupported() {
  return typeof navigator !== "undefined" && "geolocation" in navigator;
}

export async function readLocationPermission(): Promise<LocationPermissionState> {
  if (!isGeolocationSupported()) return "unsupported";
  try {
    if (!navigator.permissions?.query) return "prompt";
    const result = await navigator.permissions.query({ name: "geolocation" as PermissionName });
    if (result.state === "granted") return "granted";
    if (result.state === "denied") return "denied";
    return "prompt";
  } catch {
    return "prompt";
  }
}

function msToMph(metersPerSecond: number | null | undefined): number | undefined {
  if (metersPerSecond == null || !Number.isFinite(metersPerSecond) || metersPerSecond < 0) {
    return undefined;
  }
  return Math.round(metersPerSecond * 2.23694);
}

export function readDevicePosition(options?: {
  timeoutMs?: number;
  maximumAgeMs?: number;
  highAccuracy?: boolean;
}): Promise<GeolocationPosition> {
  if (!isGeolocationSupported()) {
    return Promise.reject(new Error("Location is not available on this device."));
  }

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: options?.highAccuracy ?? true,
      timeout: options?.timeoutMs ?? 20_000,
      maximumAge: options?.maximumAgeMs ?? 60_000,
    });
  });
}

export function positionToDriverGpsPing(
  position: GeolocationPosition,
  meta?: { sharedBy?: string; sharedByName?: string },
): DriverGpsPing {
  const { coords } = position;
  return {
    lat: coords.latitude,
    lng: coords.longitude,
    accuracyM:
      Number.isFinite(coords.accuracy) && coords.accuracy > 0
        ? Math.round(coords.accuracy)
        : undefined,
    speedMph: msToMph(coords.speed),
    headingDeg:
      coords.heading != null && Number.isFinite(coords.heading)
        ? Math.round(coords.heading)
        : undefined,
    lastPingAt: new Date(position.timestamp || Date.now()).toISOString(),
    sharedBy: meta?.sharedBy,
    sharedByName: meta?.sharedByName,
  };
}

export function describeGeolocationError(err: unknown): string {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as GeolocationPositionError).code;
    if (code === 1) return "Location permission is blocked. Enable it in browser settings.";
    if (code === 2) return "Location unavailable right now. Try again outdoors or with Wi‑Fi.";
    if (code === 3) return "Location request timed out. Try again.";
  }
  if (err instanceof Error && err.message) return err.message;
  return "Could not read your location.";
}
