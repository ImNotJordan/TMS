import * as React from "react";
import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import { MapPin } from "lucide-react";

import type { ClientDashboardLoad } from "@/lib/dashboard-types";
import { formatLane } from "@/lib/format";
import { geocodeStop, type StopPoint } from "@/lib/geocode-stop";
import { fetchRoadPath, type LatLng } from "@/lib/fetch-road-route";
import { retainMapsApiKey } from "@/lib/retain-maps-key";

let mapsLoaderConfigured = false;

function configureMapsLoader(apiKey: string) {
  if (mapsLoaderConfigured) return;
  mapsLoaderConfigured = true;
  setOptions({ key: apiKey, v: "weekly" });
}

const MAP_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ color: "#e8eef4" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#475569" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#f8fafc" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#ffffff" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#c5d4e3" }] },
  { featureType: "administrative", elementType: "geometry.stroke", stylers: [{ color: "#cbd5e1" }] },
];

/** Sibling rail, not an overlay. Overlay-sized padding greys out this pane. */
const MAP_PADDING = { top: 40, right: 40, bottom: 40, left: 40 };

type TrackingMapProps = {
  loads: ClientDashboardLoad[];
  selectedId: string | null;
  onSelect: (loadId: string) => void;
  mapsApiKey?: string | null;
};

type LaneStops = {
  loadId: string;
  pickup: StopPoint | null;
  delivery: StopPoint | null;
};

type RoadPath = {
  loadId: string;
  path: LatLng[];
};

function stopQueryKey(load: ClientDashboardLoad): string {
  return [
    load.loadId,
    load.pickupFacility,
    load.pickupAddress,
    load.pickupCity,
    load.pickupState,
    load.pickupZip,
    load.deliveryFacility,
    load.deliveryAddress,
    load.deliveryCity,
    load.deliveryState,
    load.deliveryZip,
  ].join("|");
}

function gpsSignature(loads: ClientDashboardLoad[]): string {
  return loads
    .map((load) => {
      if (!load.gps) return "";
      return `${load.loadId}:${load.gps.lat.toFixed(5)},${load.gps.lng.toFixed(5)}:${load.gps.fresh ? 1 : 0}`;
    })
    .filter(Boolean)
    .join("|");
}

function circleIcon(fill: string, scale: number): google.maps.Symbol {
  return {
    path: google.maps.SymbolPath.CIRCLE,
    scale,
    fillColor: fill,
    fillOpacity: 1,
    strokeColor: "#ffffff",
    strokeWeight: 2,
  };
}

function focusMap(map: google.maps.Map, points: Array<{ lat: number; lng: number }>) {
  if (points.length === 0) return;
  if (points.length === 1) {
    map.panTo(points[0]);
    const zoom = map.getZoom() ?? 4;
    if (zoom < 6 || zoom > 12) map.setZoom(8);
    return;
  }
  const bounds = new google.maps.LatLngBounds();
  for (const point of points) bounds.extend(point);
  map.fitBounds(bounds, MAP_PADDING);
}

export function TrackingMap({ loads, selectedId, onSelect, mapsApiKey }: TrackingMapProps) {
  const heldKeyRef = React.useRef("");
  const apiKey = retainMapsApiKey(heldKeyRef.current, mapsApiKey);
  heldKeyRef.current = apiKey;

  if (!apiKey) return <MapFallback loads={loads} selectedId={selectedId} onSelect={onSelect} />;
  return (
    <GoogleTrackingMap apiKey={apiKey} loads={loads} selectedId={selectedId} onSelect={onSelect} />
  );
}

function GoogleTrackingMap({
  apiKey,
  loads,
  selectedId,
  onSelect,
}: TrackingMapProps & { apiKey: string }) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<google.maps.Map | null>(null);
  const truckMarkersRef = React.useRef<Map<string, google.maps.Marker>>(new Map());
  const stopMarkersRef = React.useRef<google.maps.Marker[]>([]);
  const routeLinesRef = React.useRef<google.maps.Polyline[]>([]);
  const onSelectRef = React.useRef(onSelect);
  onSelectRef.current = onSelect;
  const geocodeCacheRef = React.useRef<Map<string, LaneStops>>(new Map());
  const roadCacheRef = React.useRef<Map<string, RoadPath>>(new Map());
  const focusedRef = React.useRef("");
  const [ready, setReady] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [stops, setStops] = React.useState<LaneStops | null>(null);
  const [roadPath, setRoadPath] = React.useState<RoadPath | null>(null);

  const selected = loads.find((load) => load.loadId === selectedId) ?? null;
  const selectedRef = React.useRef(selected);
  selectedRef.current = selected;
  const selectedStopKey = selected ? stopQueryKey(selected) : "";
  const selectedGpsKey = selected?.gps
    ? `${selected.gps.lat.toFixed(4)},${selected.gps.lng.toFixed(4)}`
    : "";
  const trucksSig = gpsSignature(loads);

  React.useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;
    configureMapsLoader(apiKey);
    void importLibrary("maps")
      .then((mapsLib) => {
        if (cancelled || !containerRef.current) return;
        mapRef.current = new mapsLib.Map(containerRef.current, {
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          gestureHandling: "greedy",
          clickableIcons: false,
          styles: MAP_STYLE,
          center: { lat: 39.5, lng: -98.35 },
          zoom: 4,
        });
        setError(null);
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setError("Map failed to load.");
      });
    return () => {
      cancelled = true;
    };
  }, [apiKey]);

  React.useEffect(() => {
    const map = mapRef.current;
    const el = containerRef.current;
    if (!map || !ready || !el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      google.maps.event.trigger(map, "resize");
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ready]);

  React.useEffect(() => {
    const load = selectedRef.current;
    if (!load || !apiKey || !selectedStopKey) {
      setStops(null);
      return;
    }
    const cached = geocodeCacheRef.current.get(selectedStopKey);
    if (cached) {
      setStops(cached);
      return;
    }

    const ac = new AbortController();
    void (async () => {
      const [pickup, delivery] = await Promise.all([
        geocodeStop(
          {
            facility: load.pickupFacility,
            address: load.pickupAddress,
            city: load.pickupCity,
            state: load.pickupState,
            zip: load.pickupZip,
          },
          apiKey,
          ac.signal,
        ),
        geocodeStop(
          {
            facility: load.deliveryFacility,
            address: load.deliveryAddress,
            city: load.deliveryCity,
            state: load.deliveryState,
            zip: load.deliveryZip,
          },
          apiKey,
          ac.signal,
        ),
      ]);
      if (ac.signal.aborted) return;
      const next = { loadId: load.loadId, pickup, delivery };
      geocodeCacheRef.current.set(selectedStopKey, next);
      setStops(next);
    })();
    return () => ac.abort();
  }, [apiKey, selectedStopKey]);

  React.useEffect(() => {
    const lane = stops?.loadId === selectedId ? stops : null;
    if (!lane?.pickup || !lane.delivery || !apiKey) {
      setRoadPath(null);
      return;
    }
    const cached = roadCacheRef.current.get(selectedStopKey);
    if (cached) {
      setRoadPath(cached);
      return;
    }

    const ac = new AbortController();
    void (async () => {
      const path = await fetchRoadPath(
        { ...lane.pickup, fallbackAddress: lane.pickup.label },
        { ...lane.delivery, fallbackAddress: lane.delivery.label },
        apiKey,
        ac.signal,
      );
      if (ac.signal.aborted) return;
      if (!path) {
        setRoadPath(null);
        return;
      }
      const next = { loadId: lane.loadId, path };
      roadCacheRef.current.set(selectedStopKey, next);
      setRoadPath(next);
    })();
    return () => ac.abort();
  }, [apiKey, selectedId, selectedStopKey, stops]);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const liveIds = new Set<string>();
    for (const load of loads) {
      if (!load.gps) continue;
      liveIds.add(load.loadId);
      const position = { lat: load.gps.lat, lng: load.gps.lng };
      const selectedTruck = load.loadId === selectedId;
      const icon = circleIcon(load.gps.fresh ? "#e85d04" : "#0369a1", selectedTruck ? 11 : 8);
      const existing = truckMarkersRef.current.get(load.loadId);
      if (existing) {
        existing.setPosition(position);
        existing.setIcon(icon);
        existing.setZIndex(selectedTruck ? 20 : 10);
        existing.setTitle(load.loadId);
        continue;
      }
      const marker = new google.maps.Marker({
        map,
        position,
        title: load.loadId,
        zIndex: selectedTruck ? 20 : 10,
        icon,
      });
      marker.addListener("click", () => onSelectRef.current(load.loadId));
      truckMarkersRef.current.set(load.loadId, marker);
    }
    for (const [id, marker] of truckMarkersRef.current) {
      if (liveIds.has(id)) continue;
      marker.setMap(null);
      truckMarkersRef.current.delete(id);
    }
  }, [loads, ready, selectedId, trucksSig]);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    for (const marker of stopMarkersRef.current) marker.setMap(null);
    stopMarkersRef.current = [];
    for (const line of routeLinesRef.current) line.setMap(null);
    routeLinesRef.current = [];

    const lane = stops?.loadId === selectedId ? stops : null;
    const path = roadPath?.loadId === selectedId ? roadPath.path : [];
    if (path.length > 1) {
      routeLinesRef.current = [
        new google.maps.Polyline({
          map,
          path,
          strokeColor: "#0369a1",
          strokeOpacity: 0.18,
          strokeWeight: 10,
        }),
        new google.maps.Polyline({
          map,
          path,
          strokeColor: "#0369a1",
          strokeOpacity: 0.92,
          strokeWeight: 4,
        }),
      ];
    }
    if (lane?.pickup) {
      stopMarkersRef.current.push(
        new google.maps.Marker({
          map,
          position: lane.pickup,
          title: `Pickup — ${lane.pickup.label}`,
          label: { text: "P", color: "#ffffff", fontWeight: "700" },
          icon: circleIcon("#0ea5e9", 11),
          zIndex: 5,
        }),
      );
    }
    if (lane?.delivery) {
      stopMarkersRef.current.push(
        new google.maps.Marker({
          map,
          position: lane.delivery,
          title: `Delivery — ${lane.delivery.label}`,
          label: { text: "D", color: "#ffffff", fontWeight: "700" },
          icon: circleIcon("#4f46e5", 11),
          zIndex: 5,
        }),
      );
    }

    const points: Array<{ lat: number; lng: number }> =
      path.length > 1 ? [...path] : [];
    if (lane?.pickup) points.push(lane.pickup);
    if (lane?.delivery) points.push(lane.delivery);
    const selectedLoad = selectedRef.current;
    if (selectedLoad?.gps) points.push({ lat: selectedLoad.gps.lat, lng: selectedLoad.gps.lng });

    const routeSig =
      path.length > 1
        ? `${path.length}:${path[0]?.lat},${path[0]?.lng}:${path[path.length - 1]?.lat}`
        : "";
    const focusKey = `${selectedId ?? ""}:${selectedStopKey}:${selectedGpsKey}:${routeSig}:${points.length}`;
    if (points.length === 0 || focusedRef.current === focusKey) return;
    focusedRef.current = focusKey;
    google.maps.event.trigger(map, "resize");
    focusMap(map, points);
  }, [ready, roadPath, selectedGpsKey, selectedId, selectedStopKey, stops]);

  return (
    <div className="relative h-full min-h-[280px] w-full">
      <div ref={containerRef} className="h-full w-full" />
      {!ready && !error ? <div className="absolute inset-0 bg-muted/40" aria-hidden /> : null}
      {error ? (
        <div className="absolute inset-0 flex items-center justify-center bg-background/85 px-6 text-center">
          <p className="text-sm font-medium text-destructive">{error}</p>
        </div>
      ) : null}
    </div>
  );
}

function MapFallback({ loads, selectedId, onSelect }: TrackingMapProps) {
  const tracked = loads.filter((load) => load.gps);
  return (
    <div className="flex h-full min-h-[280px] flex-col bg-slate-100">
      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "linear-gradient(#cbd5e1 1px, transparent 1px), linear-gradient(90deg, #cbd5e1 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />
        {tracked.length === 0 ? (
          <div className="relative z-10 max-w-sm px-6 text-center">
            <MapPin className="mx-auto h-8 w-8 text-sky" />
            <p className="mt-3 text-sm font-semibold text-foreground">Waiting on live GPS</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Trucks appear here when a driver shares location. Active loads still list on the
              right.
            </p>
          </div>
        ) : (
          <ul className="relative z-10 grid w-full max-w-lg gap-2 px-6">
            {tracked.map((load) => (
              <li key={load.loadId}>
                <button
                  type="button"
                  onClick={() => onSelect(load.loadId)}
                  className={`flex w-full cursor-pointer items-center justify-between rounded-lg border bg-card px-3 py-2 text-left text-sm shadow-sm transition-colors ${
                    selectedId === load.loadId ? "border-sky ring-1 ring-sky" : "border-border"
                  }`}
                >
                  <span className="font-mono text-xs font-semibold">{load.loadId}</span>
                  <span className="text-xs text-muted-foreground">{formatLane(load)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
