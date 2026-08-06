import * as React from "react";
import { importLibrary, setOptions } from "@googlemaps/js-api-loader";

import { Loader2 } from "lucide-react";

type LatLng = { lat: number; lng: number };

// The Maps JS loader only honors the first setOptions() call per page session.
let mapsLoaderConfigured = false;

function configureMapsLoader(apiKey: string) {
  if (mapsLoaderConfigured) return;
  mapsLoaderConfigured = true;
  setOptions({ key: apiKey, v: "weekly" });
}

type TrackingGoogleMapProps = {
  apiKey: string;
  pickup: LatLng & { label: string };
  delivery: LatLng & { label: string };
  gps: (LatLng & { source?: "driver" | "simulated" }) | null;
  routeLine: [number, number][];
  boundsPoints: [number, number][];
  dashedRoute: boolean;
};

function fitMapBounds(map: google.maps.Map, points: [number, number][]) {
  if (points.length === 0) return;
  if (points.length === 1) {
    map.setCenter({ lat: points[0][0], lng: points[0][1] });
    map.setZoom(9);
    return;
  }
  const bounds = new google.maps.LatLngBounds();
  for (const [lat, lng] of points) {
    bounds.extend({ lat, lng });
  }
  map.fitBounds(bounds, { top: 56, right: 56, bottom: 120, left: 56 });
}

function circleMarkerIcon(fill: string, stroke: string): google.maps.Symbol {
  return {
    path: google.maps.SymbolPath.CIRCLE,
    scale: 12,
    fillColor: fill,
    fillOpacity: 1,
    strokeColor: stroke,
    strokeWeight: 2,
  };
}

function routeKey(
  pickup: LatLng,
  delivery: LatLng,
  routeLine: [number, number][],
  dashedRoute: boolean,
) {
  const routeSig =
    routeLine.length === 0
      ? "0"
      : `${routeLine.length}:${routeLine[0]?.[0]},${routeLine[0]?.[1]}:${routeLine[routeLine.length - 1]?.[0]},${routeLine[routeLine.length - 1]?.[1]}`;
  return `${pickup.lat},${pickup.lng}|${delivery.lat},${delivery.lng}|${dashedRoute}|${routeSig}`;
}

export function TrackingGoogleMap({
  apiKey,
  pickup,
  delivery,
  gps,
  routeLine,
  boundsPoints,
  dashedRoute,
}: TrackingGoogleMapProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<google.maps.Map | null>(null);
  const staticOverlaysRef = React.useRef<{
    markers: google.maps.Marker[];
    polylines: google.maps.Polyline[];
  }>({ markers: [], polylines: [] });
  const gpsMarkerRef = React.useRef<google.maps.Marker | null>(null);
  const fittedRouteKeyRef = React.useRef<string>("");
  const [mapReady, setMapReady] = React.useState(false);
  const [mapError, setMapError] = React.useState<string | null>(null);

  const clearStaticOverlays = React.useCallback(() => {
    for (const marker of staticOverlaysRef.current.markers) marker.setMap(null);
    for (const polyline of staticOverlaysRef.current.polylines) polyline.setMap(null);
    staticOverlaysRef.current = { markers: [], polylines: [] };
  }, []);

  const clearGpsMarker = React.useCallback(() => {
    if (gpsMarkerRef.current) {
      gpsMarkerRef.current.setMap(null);
      gpsMarkerRef.current = null;
    }
  }, []);

  React.useEffect(() => {
    if (!containerRef.current) return;

    let cancelled = false;
    configureMapsLoader(apiKey);

    void importLibrary("maps")
      .then((mapsLib) => {
        if (cancelled || !containerRef.current) return;
        setMapError(null);
        mapRef.current = new mapsLib.Map(containerRef.current, {
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
          gestureHandling: "greedy",
          clickableIcons: false,
        });
        setMapReady(true);
      })
      .catch((err) => {
        if (cancelled) return;
        setMapError(
          err instanceof Error
            ? err.message
            : "Failed to load Google Maps. Check your API key and enabled APIs in Settings → Integrations.",
        );
      });

    return () => {
      cancelled = true;
      clearStaticOverlays();
      clearGpsMarker();
      mapRef.current = null;
      fittedRouteKeyRef.current = "";
      setMapReady(false);
      setMapError(null);
    };
  }, [apiKey, clearGpsMarker, clearStaticOverlays]);

  // Rebuild route/pins only when the route geometry changes — not on every GPS tick.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;

    clearStaticOverlays();

    const path = routeLine.map(([lat, lng]) => ({ lat, lng }));
    if (path.length > 1) {
      staticOverlaysRef.current.polylines.push(
        new google.maps.Polyline({
          map,
          path,
          strokeColor: "#6366f1",
          strokeOpacity: 0.2,
          strokeWeight: 9,
          geodesic: true,
        }),
        new google.maps.Polyline({
          map,
          path,
          strokeColor: dashedRoute ? "#6366f1" : "#4f46e5",
          strokeOpacity: dashedRoute ? 0.7 : 0.92,
          strokeWeight: dashedRoute ? 4 : 5,
          geodesic: true,
          icons: dashedRoute
            ? [
                {
                  icon: { path: "M 0,-1 0,1", strokeOpacity: 1, scale: 3 },
                  offset: "0",
                  repeat: "16px",
                },
              ]
            : undefined,
        }),
      );
    }

    staticOverlaysRef.current.markers.push(
      new google.maps.Marker({
        map,
        position: { lat: pickup.lat, lng: pickup.lng },
        title: `Pickup — ${pickup.label}`,
        label: { text: "P", color: "#ffffff", fontWeight: "700" },
        icon: circleMarkerIcon("#38bdf8", "#ffffff"),
      }),
      new google.maps.Marker({
        map,
        position: { lat: delivery.lat, lng: delivery.lng },
        title: `Delivery — ${delivery.label}`,
        label: { text: "D", color: "#ffffff", fontWeight: "700" },
        icon: circleMarkerIcon("#6366f1", "#ffffff"),
      }),
    );

    const key = routeKey(pickup, delivery, routeLine, dashedRoute);
    if (fittedRouteKeyRef.current !== key) {
      fittedRouteKeyRef.current = key;
      fitMapBounds(map, boundsPoints);
    }
  }, [
    mapReady,
    pickup.lat,
    pickup.lng,
    pickup.label,
    delivery.lat,
    delivery.lng,
    delivery.label,
    routeLine,
    dashedRoute,
    boundsPoints,
    clearStaticOverlays,
  ]);

  // Live GPS: mutate marker position only — avoid overlay teardown + fitBounds thrash.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;

    if (!gps) {
      clearGpsMarker();
      return;
    }

    const isLiveDriver = gps.source === "driver";
    const icon = isLiveDriver
      ? circleMarkerIcon("#ef4444", "#ffffff")
      : circleMarkerIcon("#22c55e", "#ffffff");
    const title = isLiveDriver ? "Driver live location" : "Estimated GPS";

    if (gpsMarkerRef.current) {
      gpsMarkerRef.current.setPosition(gps);
      gpsMarkerRef.current.setIcon(icon);
      gpsMarkerRef.current.setTitle(title);
      return;
    }

    gpsMarkerRef.current = new google.maps.Marker({
      map,
      position: gps,
      title,
      icon,
      zIndex: 1000,
    });
  }, [mapReady, gps, clearGpsMarker]);

  return (
    <div className="relative h-[min(420px,52vh)] w-full">
      <div ref={containerRef} className="h-full w-full" aria-label="Tracking route map" />
      {mapError ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/90 px-4 text-center">
          <p className="text-sm font-medium text-destructive">Google Maps failed to load</p>
          <p className="text-xs text-muted-foreground">{mapError}</p>
        </div>
      ) : null}
      {!mapReady && !mapError ? (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/30">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : null}
    </div>
  );
}
