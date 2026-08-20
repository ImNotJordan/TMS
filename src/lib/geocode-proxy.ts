const GOOGLE_GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";

export const GEOCODE_API_KEY_HEADER = "X-Titan-Geocode-Key";

/** Normalized result shape consumed by facility-geocode.ts */
export type GeocodeSearchResult = {
  lat?: string;
  lon?: string;
  name?: string;
  display_name?: string;
  address?: {
    house_number?: string;
    road?: string;
    city?: string;
    town?: string;
    village?: string;
    hamlet?: string;
    municipality?: string;
    suburb?: string;
    city_district?: string;
    county?: string;
    state?: string;
    postcode?: string;
  };
};

type GoogleGeocodeResponse = {
  status?: string;
  error_message?: string;
  results?: {
    formatted_address?: string;
    geometry?: { location?: { lat?: number; lng?: number } };
    address_components?: { long_name?: string; short_name?: string; types?: string[] }[];
  }[];
};

export function isGeocodeSearchRequest(url: URL, method: string) {
  return method === "GET" && url.pathname === "/api/geocode/search";
}

type GoogleAddressComponent = {
  long_name?: string;
  short_name?: string;
  types?: string[];
};

function googleComponent(
  components: GoogleAddressComponent[] | undefined,
  type: string,
  useShort = false,
) {
  const match = components?.find((c) => c.types?.includes(type));
  return (useShort ? match?.short_name : match?.long_name)?.trim() ?? "";
}

function mapGoogleResult(
  result: NonNullable<GoogleGeocodeResponse["results"]>[number],
): GeocodeSearchResult | null {
  const lat = result.geometry?.location?.lat;
  const lng = result.geometry?.location?.lng;
  if (lat === undefined || lng === undefined) return null;

  const components = result.address_components ?? [];
  const streetNumber = googleComponent(components, "street_number");
  const route = googleComponent(components, "route");
  const city =
    googleComponent(components, "locality") ||
    googleComponent(components, "postal_town") ||
    googleComponent(components, "sublocality") ||
    googleComponent(components, "administrative_area_level_2");
  const state = googleComponent(components, "administrative_area_level_1", true);
  const postcode = googleComponent(components, "postal_code");

  return {
    lat: String(lat),
    lon: String(lng),
    display_name: result.formatted_address,
    address: {
      house_number: streetNumber,
      road: route,
      city,
      state,
      postcode,
    },
  };
}

async function handleGoogleGeocodeSearch(requestUrl: URL, apiKey: string): Promise<Response> {
  const q = requestUrl.searchParams.get("q")?.trim();
  if (!q) {
    return Response.json({ error: "Missing q parameter" }, { status: 400 });
  }

  const limit = Math.min(
    10,
    Math.max(1, Number.parseInt(requestUrl.searchParams.get("limit") ?? "5", 10) || 5),
  );

  const params = new URLSearchParams({
    address: q,
    key: apiKey,
    components: "country:US",
  });

  const upstream = await fetch(`${GOOGLE_GEOCODE_URL}?${params.toString()}`, {
    headers: { Accept: "application/json" },
  });

  if (!upstream.ok) {
    return Response.json(
      { error: `Google Geocoding API error (HTTP ${upstream.status})` },
      { status: 502 },
    );
  }

  const payload = (await upstream.json()) as GoogleGeocodeResponse;
  if (payload.status && payload.status !== "OK" && payload.status !== "ZERO_RESULTS") {
    return Response.json(
      { error: payload.error_message ?? `Google Geocoding status: ${payload.status}` },
      { status: 400 },
    );
  }

  const mapped =
    payload.results
      ?.map(mapGoogleResult)
      .filter((row): row is GeocodeSearchResult => row !== null)
      .slice(0, limit) ?? [];

  return Response.json(mapped, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, max-age=3600",
    },
  });
}

/** Proxies geocode search to Google Geocoding API (Settings → Integrations). */
export async function handleGeocodeSearchRequest(
  requestUrl: URL,
  request?: Request,
): Promise<Response> {
  const q = requestUrl.searchParams.get("q")?.trim();
  if (!q) {
    return Response.json({ error: "Missing q parameter" }, { status: 400 });
  }

  const provider = requestUrl.searchParams.get("provider")?.trim().toLowerCase();
  const apiKey = request?.headers.get(GEOCODE_API_KEY_HEADER)?.trim() ?? "";

  if (provider !== "google") {
    return Response.json(
      {
        error:
          "Only Google Maps geocoding is supported. Configure Google Maps under Settings → Integrations.",
      },
      { status: 400 },
    );
  }

  if (!apiKey) {
    return Response.json(
      {
        error:
          "Google Maps is selected but no API key was provided. Configure Google Maps under Settings → Integrations.",
      },
      { status: 400 },
    );
  }

  return handleGoogleGeocodeSearch(requestUrl, apiKey);
}
