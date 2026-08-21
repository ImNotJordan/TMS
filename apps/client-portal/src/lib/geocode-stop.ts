import { apiUrl } from "./api-base";

const GEOCODE_API_KEY_HEADER = "X-Titan-Geocode-Key";

export type StopPoint = {
  lat: number;
  lng: number;
  label: string;
};

function queryFor(stop: {
  facility?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
}): string {
  return [stop.facility, stop.address, stop.city, stop.state, stop.zip]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(", ");
}

/**
 * Resolve a stop through the ops geocode proxy using this company's Maps key.
 *
 * The browser never talks to Google Geocoding with the key on the query string;
 * the Worker holds that call. Failures are empty, not thrown — a load without a
 * pin is still a load.
 */
export async function geocodeStop(
  stop: {
    facility?: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
  },
  apiKey: string,
  signal: AbortSignal,
): Promise<StopPoint | null> {
  const q = queryFor(stop);
  if (!q || !apiKey) return null;
  const label = [stop.city, stop.state].filter(Boolean).join(", ") || stop.facility || q;
  try {
    const url = apiUrl(`/api/geocode/search?provider=google&limit=1&q=${encodeURIComponent(q)}`);
    const response = await fetch(url, {
      signal,
      headers: { Accept: "application/json", [GEOCODE_API_KEY_HEADER]: apiKey },
    });
    if (!response.ok) return null;
    const rows = (await response.json()) as Array<{ lat?: string; lon?: string }>;
    const lat = Number(rows[0]?.lat);
    const lng = Number(rows[0]?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng, label };
  } catch {
    return null;
  }
}
