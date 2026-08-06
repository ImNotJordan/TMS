import { GEOCODE_API_KEY_HEADER } from "@/lib/geocode-proxy";

const GOOGLE_DIRECTIONS_URL = "https://maps.googleapis.com/maps/api/directions/json";
const GOOGLE_ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";

type GoogleDirectionsResponse = {
  status?: string;
  error_message?: string;
  routes?: {
    overview_polyline?: { points?: string };
    legs?: { distance?: { value?: number }; duration?: { value?: number } }[];
  }[];
};

type GoogleRoutesResponse = {
  routes?: {
    polyline?: { encodedPolyline?: string };
    distanceMeters?: number;
    /** Duration as a string like "12345s". */
    duration?: string;
  }[];
  error?: { message?: string };
};

type ProxyRouteResult = {
  polyline: string;
  distanceMeters: number;
  durationSeconds: number;
};

function parseLatLng(value: string): { latitude: number; longitude: number } | null {
  const [latRaw, lngRaw] = value.split(",");
  const latitude = Number.parseFloat(latRaw ?? "");
  const longitude = Number.parseFloat(lngRaw ?? "");
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}

/** Accepts either "lat,lng" or a free-form address string. */
function toRoutesApiWaypoint(value: string) {
  const latLng = parseLatLng(value);
  return latLng ? { location: { latLng } } : { address: value };
}

/** Modern Routes API — required for API keys created in newer Google Cloud projects. */
async function fetchViaRoutesApi(
  origin: string,
  destination: string,
  apiKey: string,
): Promise<ProxyRouteResult | null> {

  const upstream = await fetch(GOOGLE_ROUTES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "routes.polyline.encodedPolyline,routes.distanceMeters,routes.duration",
    },
    body: JSON.stringify({
      origin: toRoutesApiWaypoint(origin),
      destination: toRoutesApiWaypoint(destination),
      travelMode: "DRIVE",
      polylineQuality: "OVERVIEW",
    }),
  });

  if (!upstream.ok) return null;

  const payload = (await upstream.json()) as GoogleRoutesResponse;
  const route = payload.routes?.[0];
  const polyline = route?.polyline?.encodedPolyline;
  if (!polyline) return null;

  return {
    polyline,
    distanceMeters: route.distanceMeters ?? 0,
    durationSeconds: Number.parseInt(route.duration ?? "0", 10) || 0,
  };
}

/** Legacy Directions API — only available on older Google Cloud projects. */
async function fetchViaLegacyDirectionsApi(
  origin: string,
  destination: string,
  apiKey: string,
): Promise<ProxyRouteResult | { error: string; status: number } | null> {
  const params = new URLSearchParams({
    origin,
    destination,
    key: apiKey,
    mode: "driving",
    units: "imperial",
  });

  const upstream = await fetch(`${GOOGLE_DIRECTIONS_URL}?${params.toString()}`, {
    headers: { Accept: "application/json" },
  });

  if (!upstream.ok) {
    return { error: `Google Directions API error (HTTP ${upstream.status})`, status: 502 };
  }

  const payload = (await upstream.json()) as GoogleDirectionsResponse;
  if (payload.status && payload.status !== "OK" && payload.status !== "ZERO_RESULTS") {
    return {
      error: payload.error_message ?? `Google Directions status: ${payload.status}`,
      status: 400,
    };
  }

  const route = payload.routes?.[0];
  const encoded = route?.overview_polyline?.points;
  if (!encoded) return null;

  return {
    polyline: encoded,
    distanceMeters:
      route.legs?.reduce((sum, leg) => sum + (leg.distance?.value ?? 0), 0) ?? 0,
    durationSeconds:
      route.legs?.reduce((sum, leg) => sum + (leg.duration?.value ?? 0), 0) ?? 0,
  };
}

export function isGoogleDirectionsRequest(url: URL, method: string) {
  return method === "GET" && url.pathname === "/api/google/directions";
}

/** Proxies driving directions to Google Directions API. */
export async function handleGoogleDirectionsRequest(
  requestUrl: URL,
  request?: Request,
): Promise<Response> {
  const origin = requestUrl.searchParams.get("origin")?.trim();
  const destination = requestUrl.searchParams.get("destination")?.trim();
  if (!origin || !destination) {
    return Response.json({ error: "Missing origin or destination parameter" }, { status: 400 });
  }

  const apiKey = request?.headers.get(GEOCODE_API_KEY_HEADER)?.trim() ?? "";
  if (!apiKey) {
    return Response.json(
      {
        error:
          "Google Maps API key is required. Configure Google Maps under Settings → Integrations.",
      },
      { status: 400 },
    );
  }

  async function computeRoute(
    fromWaypoint: string,
    toWaypoint: string,
  ): Promise<ProxyRouteResult | { error: string; status: number } | null> {
    let routed: ProxyRouteResult | null = null;
    try {
      routed = await fetchViaRoutesApi(fromWaypoint, toWaypoint, apiKey);
    } catch (err) {
      console.error("[directions-proxy] Routes API request failed:", err);
    }
    if (routed) return routed;

    try {
      return await fetchViaLegacyDirectionsApi(fromWaypoint, toWaypoint, apiKey);
    } catch (err) {
      console.error("[directions-proxy] Legacy Directions API request failed:", err);
      return null;
    }
  }

  let result = await computeRoute(origin, destination);

  // Exact coordinates can be unroutable (e.g. a facility pin in a wilderness area
  // far from any road). Retry with the caller-provided fallback addresses.
  const originFallback = requestUrl.searchParams.get("originFallback")?.trim();
  const destinationFallback = requestUrl.searchParams.get("destinationFallback")?.trim();
  if (
    (!result || "error" in result) &&
    (originFallback || destinationFallback)
  ) {
    console.warn(
      "[directions-proxy] No route for exact coordinates; retrying with fallback addresses.",
    );
    result = await computeRoute(
      originFallback || origin,
      destinationFallback || destination,
    );
  }

  if (result && "error" in result) {
    console.error("[directions-proxy]", result.error);
    return Response.json({ error: result.error }, { status: result.status });
  }

  if (!result) {
    return Response.json({
      status: "ZERO_RESULTS",
      polyline: null,
      distanceMeters: 0,
      durationSeconds: 0,
    });
  }

  return Response.json(
    {
      status: "OK",
      polyline: result.polyline,
      distanceMeters: result.distanceMeters,
      durationSeconds: result.durationSeconds,
    },
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "private, max-age=300",
      },
    },
  );
}
