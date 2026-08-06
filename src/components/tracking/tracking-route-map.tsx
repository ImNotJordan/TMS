import * as React from "react";
import { Loader2, MapPin, Navigation, RefreshCw, Truck } from "lucide-react";

import { geocodeStopCoordinates } from "@/components/loads/facility-geocode";
import { TrackingGoogleMap } from "@/components/tracking/tracking-google-map";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useGoogleMapsIntegration } from "@/hooks/use-google-maps-integration";
import {
  fetchRoadRoute,
  formatRouteDistanceMiles,
  straightLinePositions,
  type RouteWaypoint,
} from "@/lib/google-maps-route";
import type { TrackingSession } from "@/lib/tracking-workflow-store";

type MapPoint = {
  lat: number;
  lng: number;
  label: string;
  facility: string;
  city: string;
  state: string;
};

type TrackingRouteMapProps = {
  session: TrackingSession;
};

function fallbackPoint(
  seed: string,
  stop: { facility: string; city: string; state: string },
): MapPoint {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  const ratio = Math.abs(hash % 10_000) / 10_000;
  const ratioLng = Math.abs((hash * 7) % 10_000) / 10_000;
  return {
    lat: 26 + (46 - 26) * ratio,
    lng: -122 + (-73 - -122) * ratioLng,
    label: [stop.city, stop.state].filter(Boolean).join(", ") || stop.facility,
    facility: stop.facility,
    city: stop.city,
    state: stop.state,
  };
}

function MapSkeleton({ providerLabel }: { providerLabel: string }) {
  return (
    <div className="relative h-[min(420px,52vh)] overflow-hidden rounded-2xl border border-border/70 bg-gradient-to-br from-muted/40 via-card to-info/5">
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm font-medium text-foreground">Plotting route on map…</p>
        <p className="text-xs text-muted-foreground">Using integration: {providerLabel}</p>
      </div>
    </div>
  );
}

function MapsNotConfigured({
  workspaceConfigured,
  loadError,
}: {
  workspaceConfigured: boolean;
  loadError: string | null;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border/80 bg-muted/20 px-6 py-14 text-center">
      <MapPin className="h-8 w-8 text-muted-foreground" />
      <p className="text-sm font-medium text-foreground">Google Maps integration required</p>
      <p className="max-w-sm text-xs text-muted-foreground">
        {!workspaceConfigured ? (
          <>
            Workspace settings are not available. Set{" "}
            <code className="text-[10px]">VITE_WORKSPACE_SETTINGS_TABLE_NAME</code> in{" "}
            <code className="text-[10px]">.env</code>, then sign in.
          </>
        ) : (
          <>
            Open <span className="font-medium text-foreground">Settings → Integrations</span>, configure
            Google Maps (API key + enable geocoding), and save. The tracking map uses that same
            integration for tiles, pins, and directions.
          </>
        )}
      </p>
      {loadError ? <p className="max-w-sm text-xs text-destructive">{loadError}</p> : null}
    </div>
  );
}

export function TrackingRouteMap({ session }: TrackingRouteMapProps) {
  const {
    apiKey,
    mapsActive,
    loading: integrationLoading,
    error: integrationError,
    enabled: workspaceConfigured,
    providerLabel,
  } = useGoogleMapsIntegration();

  const [pickup, setPickup] = React.useState<MapPoint | null>(null);
  const [delivery, setDelivery] = React.useState<MapPoint | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [usedFallback, setUsedFallback] = React.useState(false);
  const [roadRoute, setRoadRoute] = React.useState<[number, number][] | null>(null);
  const [roadRouteDistanceLabel, setRoadRouteDistanceLabel] = React.useState<string | null>(null);
  const [routingRoads, setRoutingRoads] = React.useState(false);
  const [usedStraightFallback, setUsedStraightFallback] = React.useState(false);

  const stopKey = React.useMemo(
    () =>
      [
        session.loadId,
        session.pickup.facility,
        session.pickup.address,
        session.pickup.city,
        session.pickup.state,
        session.delivery.facility,
        session.delivery.address,
        session.delivery.city,
        session.delivery.state,
      ].join("|"),
    [
      session.loadId,
      session.pickup.facility,
      session.pickup.address,
      session.pickup.city,
      session.pickup.state,
      session.delivery.facility,
      session.delivery.address,
      session.delivery.city,
      session.delivery.state,
    ],
  );

  const loadPoints = React.useCallback(
    async (signal: AbortSignal) => {
      if (!mapsActive) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const [pickupGeo, deliveryGeo] = await Promise.all([
          geocodeStopCoordinates(
            {
              facility: session.pickup.facility,
              address: session.pickup.address,
              city: session.pickup.city,
              state: session.pickup.state,
            },
            signal,
          ),
          geocodeStopCoordinates(
            {
              facility: session.delivery.facility,
              address: session.delivery.address,
              city: session.delivery.city,
              state: session.delivery.state,
            },
            signal,
          ),
        ]);

        let fallback = false;
        const pickupPoint: MapPoint = pickupGeo
          ? {
              lat: pickupGeo.lat,
              lng: pickupGeo.lng,
              label: pickupGeo.label,
              facility: session.pickup.facility,
              city: session.pickup.city,
              state: session.pickup.state,
            }
          : (() => {
              fallback = true;
              return fallbackPoint(`${session.loadId}:pickup`, session.pickup);
            })();

        const deliveryPoint: MapPoint = deliveryGeo
          ? {
              lat: deliveryGeo.lat,
              lng: deliveryGeo.lng,
              label: deliveryGeo.label,
              facility: session.delivery.facility,
              city: session.delivery.city,
              state: session.delivery.state,
            }
          : (() => {
              fallback = true;
              return fallbackPoint(`${session.loadId}:delivery`, session.delivery);
            })();

        setPickup(pickupPoint);
        setDelivery(deliveryPoint);
        setUsedFallback(fallback);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Could not load map.");
      } finally {
        setLoading(false);
      }
    },
    // Depend on stable address fingerprint, not the whole session (GPS ticks).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stopKey captures address fields
    [mapsActive, stopKey],
  );

  React.useEffect(() => {
    if (integrationLoading) return;
    const controller = new AbortController();
    void loadPoints(controller.signal);
    return () => controller.abort();
  }, [integrationLoading, loadPoints]);

  const gps = session.gps.location;
  const gpsSource = session.gps.source ?? "simulated";
  const hasGps =
    Number.isFinite(gps.lat) &&
    Number.isFinite(gps.lng) &&
    (gps.lat !== 0 || gps.lng !== 0);
  const isLiveDriverGps = hasGps && gpsSource === "driver";

  const routingWaypoints: RouteWaypoint[] = React.useMemo(() => {
    if (!pickup || !delivery) return [];
    const stopFallback = (stop: MapPoint) =>
      [stop.city, stop.state].filter(Boolean).join(", ") || stop.facility || undefined;
    return [
      { lat: pickup.lat, lng: pickup.lng, fallbackAddress: stopFallback(pickup) },
      { lat: delivery.lat, lng: delivery.lng, fallbackAddress: stopFallback(delivery) },
    ];
  }, [pickup, delivery]);

  const mapPinPoints: [number, number][] = React.useMemo(() => {
    const pts: [number, number][] = [];
    if (pickup) pts.push([pickup.lat, pickup.lng]);
    if (delivery) pts.push([delivery.lat, delivery.lng]);
    return pts;
  }, [pickup, delivery]);

  React.useEffect(() => {
    if (!mapsActive || routingWaypoints.length < 2) {
      setRoadRoute(null);
      return;
    }

    const controller = new AbortController();
    setRoutingRoads(true);
    setUsedStraightFallback(false);

    void (async () => {
      try {
        const result = await fetchRoadRoute(routingWaypoints, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (result?.positions.length) {
          setRoadRoute(result.positions);
          setRoadRouteDistanceLabel(formatRouteDistanceMiles(result.distanceMeters));
          return;
        }
        setRoadRoute(straightLinePositions(routingWaypoints));
        setUsedStraightFallback(true);
        setRoadRouteDistanceLabel(null);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        console.warn("[tracking-route-map] Road routing failed, using direct line:", err);
        setRoadRoute(straightLinePositions(routingWaypoints));
        setUsedStraightFallback(true);
        setRoadRouteDistanceLabel(null);
      } finally {
        if (!controller.signal.aborted) setRoutingRoads(false);
      }
    })();

    return () => controller.abort();
  }, [mapsActive, routingWaypoints]);

  const routeLine: [number, number][] = roadRoute ?? [];

  const boundsPoints: [number, number][] = React.useMemo(() => {
    if (routeLine.length > 1) {
      return [...routeLine, ...mapPinPoints];
    }
    return mapPinPoints;
  }, [routeLine, mapPinPoints]);

  if (integrationLoading) {
    return <MapSkeleton providerLabel={providerLabel} />;
  }

  if (!mapsActive || !apiKey) {
    return (
      <MapsNotConfigured
        workspaceConfigured={workspaceConfigured}
        loadError={integrationError}
      />
    );
  }

  if (loading) {
    return <MapSkeleton providerLabel={providerLabel} />;
  }

  if (error || !pickup || !delivery) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border/80 bg-muted/20 px-6 py-14 text-center">
        <MapPin className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">{error ?? "Map unavailable"}</p>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={() => {
            const controller = new AbortController();
            void loadPoints(controller.signal);
          }}
        >
          <RefreshCw className="h-3.5 w-3.5" /> Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-2xl border border-border/70 shadow-[0_20px_50px_-24px_rgba(15,23,42,0.35)]">
        <div className="pointer-events-none absolute inset-x-0 top-0 z-[500] flex flex-wrap items-start justify-between gap-2 p-3">
          <div className="flex flex-wrap gap-2">
            <Badge className="gap-1.5 border-info/30 bg-info/15 text-info shadow-sm backdrop-blur-sm">
              <span className="flex h-4 w-4 items-center justify-center rounded-md bg-info text-[10px] font-bold text-info-foreground">
                P
              </span>
              Pickup
            </Badge>
            <Badge className="gap-1.5 border-primary/30 bg-primary/15 text-primary shadow-sm backdrop-blur-sm">
              <span className="flex h-4 w-4 items-center justify-center rounded-md bg-primary text-[10px] font-bold text-primary-foreground">
                D
              </span>
              Delivery
            </Badge>
            {hasGps && (
              <Badge
                className={
                  isLiveDriverGps
                    ? "gap-1.5 border-red-500/35 bg-red-500/15 text-red-600 shadow-sm backdrop-blur-sm dark:text-red-400"
                    : "gap-1.5 border-success/30 bg-success/15 text-success shadow-sm backdrop-blur-sm"
                }
              >
                <span
                  className={
                    isLiveDriverGps
                      ? "relative flex h-2 w-2"
                      : "hidden"
                  }
                >
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
                </span>
                {!isLiveDriverGps ? <Truck className="h-3 w-3" /> : null}
                {isLiveDriverGps ? "Driver live" : "Estimated GPS"}
              </Badge>
            )}
            <Badge variant="outline" className="bg-background/80 text-[10px] backdrop-blur-sm">
              Google Maps integration
            </Badge>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {usedFallback && (
              <Badge variant="outline" className="bg-background/80 text-[10px] backdrop-blur-sm">
                Approximate pins
              </Badge>
            )}
            {routingRoads && (
              <Badge variant="outline" className="gap-1 bg-background/80 text-[10px] backdrop-blur-sm">
                <Loader2 className="h-3 w-3 animate-spin" /> Routing roads…
              </Badge>
            )}
            {usedStraightFallback && !routingRoads && (
              <Badge variant="outline" className="bg-background/80 text-[10px] backdrop-blur-sm">
                Direct line (directions unavailable)
              </Badge>
            )}
          </div>
        </div>

        <TrackingGoogleMap
          key={apiKey}
          apiKey={apiKey}
          pickup={pickup}
          delivery={delivery}
          gps={
            hasGps
              ? { lat: gps.lat, lng: gps.lng, source: gpsSource }
              : null
          }
          routeLine={routeLine}
          boundsPoints={boundsPoints}
          dashedRoute={usedStraightFallback}
        />

        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[500] bg-gradient-to-t from-background/80 via-background/35 to-transparent px-2 pb-2 pt-5">
          <div className="pointer-events-auto mx-auto grid max-w-md gap-1.5 sm:grid-cols-2">
            <StopCard kind="pickup" point={pickup} date={session.pickup.date} />
            <StopCard kind="delivery" point={delivery} date={session.delivery.date} />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Navigation className="h-3.5 w-3.5" />
          {roadRouteDistanceLabel
            ? `${roadRouteDistanceLabel} via Google Directions`
            : `${session.milesTotal} mi route`}{" "}
          · {session.milesRemaining} mi remaining
        </span>
        <span>Settings → Integrations · Google Maps</span>
      </div>
    </div>
  );
}

function StopCard({
  kind,
  point,
  date,
}: {
  kind: "pickup" | "delivery";
  point: MapPoint;
  date?: string;
}) {
  const isPickup = kind === "pickup";
  return (
    <div
      className={`rounded-lg border bg-background/90 px-2 py-1.5 shadow-md backdrop-blur-sm ${
        isPickup ? "border-info/25" : "border-primary/25"
      }`}
    >
      <div className="flex items-start gap-1.5">
        <span
          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[9px] font-bold text-white ${
            isPickup ? "bg-info" : "bg-primary"
          }`}
        >
          {isPickup ? "P" : "D"}
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">
            {isPickup ? "Pickup" : "Delivery"}
          </p>
          <p className="truncate text-xs font-semibold text-foreground">{point.facility}</p>
          <p className="truncate text-[10px] text-muted-foreground">
            {point.city}, {point.state}
          </p>
          {date && (
            <p className="truncate text-[9px] text-muted-foreground">Scheduled {date}</p>
          )}
        </div>
      </div>
    </div>
  );
}
