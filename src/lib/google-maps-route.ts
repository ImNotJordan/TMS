import { GEOCODE_API_KEY_HEADER } from "@/lib/geocode-proxy";
import { decodeGooglePolyline } from "@/lib/google-polyline";
import {
  ensureIntegrationsConfigLoaded,
  getStoredGeocodeApiKey,
  isGoogleMapsGeocodingEnabled,
} from "@/lib/integrations-config";

export type RouteWaypoint = {
  lat: number;
  lng: number;
  /** Free-form address (e.g. "City, ST") used when the exact coordinates are unroutable. */
  fallbackAddress?: string;
};

export type RoadRouteResult = {
  /** Map positions as [lat, lng]. */
  positions: [number, number][];
  distanceMeters: number;
  durationSeconds: number;
};

type DirectionsApiResponse = {
  polyline?: string | null;
  distanceMeters?: number;
  durationSeconds?: number;
  error?: string;
};

export function straightLinePositions(waypoints: RouteWaypoint[]): [number, number][] {
  return waypoints.map((w) => [w.lat, w.lng] as [number, number]);
}

/** Fetch a driving route via Google Directions API (Settings → Integrations). */
export async function fetchRoadRoute(
  waypoints: RouteWaypoint[],
  options?: { signal?: AbortSignal },
): Promise<RoadRouteResult | null> {
  if (waypoints.length < 2) return null;

  await ensureIntegrationsConfigLoaded();
  if (!isGoogleMapsGeocodingEnabled()) {
    console.warn(
      "[google-maps-route] Skipping directions: Google Maps integration is disabled or has no API key.",
    );
    return null;
  }

  const apiKey = getStoredGeocodeApiKey();
  const origin = `${waypoints[0].lat},${waypoints[0].lng}`;
  const destination = `${waypoints[waypoints.length - 1].lat},${waypoints[waypoints.length - 1].lng}`;

  const params = new URLSearchParams({ origin, destination });
  const originFallback = waypoints[0].fallbackAddress?.trim();
  const destinationFallback = waypoints[waypoints.length - 1].fallbackAddress?.trim();
  if (originFallback) params.set("originFallback", originFallback);
  if (destinationFallback) params.set("destinationFallback", destinationFallback);
  const response = await fetch(`/api/google/directions?${params.toString()}`, {
    signal: options?.signal,
    headers: {
      Accept: "application/json",
      [GEOCODE_API_KEY_HEADER]: apiKey,
    },
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as DirectionsApiResponse | null;
    console.warn(
      "[google-maps-route] Directions request failed:",
      payload?.error ?? `HTTP ${response.status}`,
    );
    return null;
  }

  const payload = (await response.json()) as DirectionsApiResponse;
  if (!payload.polyline) {
    console.warn("[google-maps-route] Directions returned no polyline:", payload);
    return null;
  }

  const positions = decodeGooglePolyline(payload.polyline);
  if (positions.length === 0) {
    console.warn("[google-maps-route] Could not decode route polyline.");
    return null;
  }

  return {
    positions,
    distanceMeters: payload.distanceMeters ?? 0,
    durationSeconds: payload.durationSeconds ?? 0,
  };
}

export function formatRouteDistanceMiles(meters: number) {
  if (!Number.isFinite(meters) || meters <= 0) return null;
  return `${Math.round(meters / 1609.344)} mi`;
}
