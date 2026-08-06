import { GEOCODE_API_KEY_HEADER, type GeocodeSearchResult } from "@/lib/geocode-proxy";
import {
  ensureIntegrationsConfigLoaded,
  getActiveGeocodeProviderLabel,
  getStoredGeocodeApiKey,
  isGoogleMapsGeocodingEnabled,
} from "@/lib/integrations-config";

export type StopAutofillResult = {
  address: string;
  city: string;
  state: string;
  zip: string;
};

export type FacilitySuggestion = {
  id: string;
  label: string;
  facilityName: string;
  parsed: StopAutofillResult;
};

/** App geocode proxy — Google Maps only (Settings → Integrations). */
function resolveGeocodeSearchApiUrl() {
  return "/api/geocode/search";
}

const GEOCODE_SEARCH_API_URL = resolveGeocodeSearchApiUrl();

const STATE_NAME_TO_CODE: Record<string, string> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
  "district of columbia": "DC",
};

function normalizeStateCode(value?: string) {
  const raw = value?.trim();
  if (!raw) return "";
  if (raw.length === 2) return raw.toUpperCase();
  return STATE_NAME_TO_CODE[raw.toLowerCase()] ?? raw.toUpperCase();
}

function normalizeUsZip(value?: string) {
  const zip = value?.trim();
  if (!zip) return "";
  const match = zip.match(/^\d{5}(?:-\d{4})?/);
  return match?.[0] ?? zip;
}

function getBestCity(address?: GeocodeSearchResult["address"]) {
  return (
    address?.city ??
    address?.town ??
    address?.village ??
    address?.hamlet ??
    address?.municipality ??
    address?.suburb ??
    address?.city_district ??
    address?.county ??
    ""
  );
}

function getStreetAddress(address?: GeocodeSearchResult["address"]) {
  const houseNumber = address?.house_number?.trim() ?? "";
  const road = address?.road?.trim() ?? "";
  return [houseNumber, road].filter(Boolean).join(" ");
}

function extractZipFromDisplay(displayName?: string) {
  const match = displayName?.match(/\b(\d{5})(?:-\d{4})?\b/);
  return match?.[1] ?? "";
}

function parseStopAutofillResult(result: GeocodeSearchResult): StopAutofillResult | null {
  const addr = result.address;
  if (!addr) return null;

  const city = getBestCity(addr).trim();
  const state = normalizeStateCode(addr.state);
  if (!city || !state) return null;

  const street = getStreetAddress(addr);
  const roadOnly = addr.road?.trim() ?? "";
  const address =
    street ||
    roadOnly ||
    result.name?.trim() ||
    result.display_name?.split(",")[0]?.trim() ||
    "";

  const zip = normalizeUsZip(addr.postcode) || extractZipFromDisplay(result.display_name);
  return { address, city, state, zip };
}

function buildGeocodeFetchInit(limit: string): { params: URLSearchParams; headers: Record<string, string> } {
  const params = new URLSearchParams({ q: "", limit, provider: "google" });
  const headers: Record<string, string> = {
    Accept: "application/json",
    [GEOCODE_API_KEY_HEADER]: getStoredGeocodeApiKey(),
  };
  return { params, headers };
}

async function fetchGeocodePayload(query: string, signal: AbortSignal, limit = "8") {
  if (!isGoogleMapsGeocodingEnabled()) {
    return [] as GeocodeSearchResult[];
  }

  const q =
    query.includes("United States") || query.includes("USA") ? query : `${query} United States`;

  const { params, headers } = buildGeocodeFetchInit(limit);
  params.set("q", q);
  const url = `${GEOCODE_SEARCH_API_URL}?${params.toString()}`;

  const response = await fetch(url, { signal, headers });
  if (!response.ok) {
    if (import.meta.env.DEV) {
      const body = (await response.clone().json().catch(() => null)) as { error?: string } | null;
      console.warn("[facility-geocode] Google geocode failed:", body?.error ?? response.status);
    }
    return [] as GeocodeSearchResult[];
  }

  return (await response.json()) as GeocodeSearchResult[];
}

export { getActiveGeocodeProviderLabel };

export async function fetchFacilitySuggestions(
  query: string,
  signal: AbortSignal,
): Promise<FacilitySuggestion[]> {
  await ensureIntegrationsConfigLoaded();
  if (!isGoogleMapsGeocodingEnabled()) return [];

  const trimmed = query.trim();
  if (trimmed.length < 3) return [];

  const queries = [trimmed, `${trimmed}, USA`];
  const seen = new Set<string>();
  const suggestions: FacilitySuggestion[] = [];

  for (const q of queries) {
    let payload: GeocodeSearchResult[];
    try {
      payload = await fetchGeocodePayload(q, signal);
    } catch (error) {
      if ((error as Error).name === "AbortError") throw error;
      continue;
    }

    for (let i = 0; i < payload.length; i++) {
      const result = payload[i];
      const parsed = parseStopAutofillResult(result);
      if (!parsed) continue;

      const label =
        result.display_name ??
        [parsed.address, parsed.city, parsed.state, parsed.zip].filter(Boolean).join(", ");
      if (seen.has(label)) continue;
      seen.add(label);

      suggestions.push({
        id: `${label}-${suggestions.length}`,
        label,
        facilityName: result.name?.trim() || trimmed,
        parsed,
      });
    }

    if (suggestions.length > 0) break;
  }

  return suggestions;
}

export type GeocodedCoordinates = {
  lat: number;
  lng: number;
  label: string;
};

function buildStopGeocodeQuery(parts: {
  facility?: string;
  address?: string;
  city?: string;
  state?: string;
}) {
  return [parts.facility, parts.address, parts.city, parts.state].filter(Boolean).join(", ");
}

/** Resolve lat/lng for a stop via the configured geocode provider (Settings → Integrations). */
export async function geocodeStopCoordinates(
  parts: {
    facility?: string;
    address?: string;
    city?: string;
    state?: string;
  },
  signal?: AbortSignal,
): Promise<GeocodedCoordinates | null> {
  await ensureIntegrationsConfigLoaded();
  if (!isGoogleMapsGeocodingEnabled()) return null;

  const base = buildStopGeocodeQuery(parts).trim();
  if (base.length < 3) return null;

  const queries = [base, `${base}, USA`];
  for (const q of queries) {
    let payload: GeocodeSearchResult[];
    try {
      payload = await fetchGeocodePayload(q, signal ?? new AbortController().signal, "3");
    } catch (error) {
      if ((error as Error).name === "AbortError") throw error;
      continue;
    }

    for (const result of payload) {
      const lat = Number(result.lat);
      const lng = Number(result.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

      const parsed = parseStopAutofillResult(result);
      const label =
        result.display_name ??
        (parsed
          ? [parsed.address, parsed.city, parsed.state].filter(Boolean).join(", ")
          : base);

      return { lat, lng, label };
    }
  }

  return null;
}
