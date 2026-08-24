import { apiUrl } from "./api-base";

const MAPS_PROXY_KEY_HEADER = "X-Titan-Geocode-Key";

export type LatLng = { lat: number; lng: number };

export type RoadWaypoint = LatLng & { fallbackAddress?: string };

/** Decode a Google encoded polyline into map positions. */
export function decodeGooglePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const deltaLat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += deltaLat;

    result = 0;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const deltaLng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += deltaLng;

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }

  return points;
}

function asCoord(point: RoadWaypoint): string {
  return `${point.lat},${point.lng}`;
}

/**
 * Driving path between two stops, via the ops Directions proxy.
 *
 * A geodesic between pins is not a lane. This returns the road geometry Google
 * would navigate, using this company's Maps key. Empty when Directions cannot
 * snap the pair (ocean legs, missing APIs) — never a fake straight line.
 */
export async function fetchRoadPath(
  origin: RoadWaypoint,
  destination: RoadWaypoint,
  apiKey: string,
  signal: AbortSignal,
): Promise<LatLng[] | null> {
  if (!apiKey) return null;
  const params = new URLSearchParams({
    origin: asCoord(origin),
    destination: asCoord(destination),
    quality: "high",
  });
  const originFallback = origin.fallbackAddress?.trim();
  const destinationFallback = destination.fallbackAddress?.trim();
  if (originFallback) params.set("originFallback", originFallback);
  if (destinationFallback) params.set("destinationFallback", destinationFallback);

  try {
    const response = await fetch(apiUrl(`/api/google/directions?${params.toString()}`), {
      signal,
      headers: { Accept: "application/json", [MAPS_PROXY_KEY_HEADER]: apiKey },
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { polyline?: string | null };
    if (!payload.polyline) return null;
    const path = decodeGooglePolyline(payload.polyline);
    return path.length > 1 ? path : null;
  } catch {
    return null;
  }
}
