import { Loader2, MapPin, Navigation, ShieldAlert } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useLoads } from "@/lib/loads-store";
import { cn } from "@/lib/utils";

function formatPingAge(iso: string | null): string | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return null;
  const mins = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (mins < 1) return "just now";
  if (mins === 1) return "1 min ago";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return hours === 1 ? "1 hr ago" : `${hours} hr ago`;
}

export function LocationShareCard({ description }: { description?: string }) {
  const {
    locationSharing,
    setLocationSharing,
    lastGpsPingAt,
    lastGpsError,
    gpsPublishing,
    activeLoad,
    publishLocationNow,
  } = useLoads();

  const age = formatPingAge(lastGpsPingAt);
  const statusLine = !locationSharing
    ? "Off · dispatch cannot see your position"
    : !activeLoad
      ? "On · waiting for an active load"
      : gpsPublishing
        ? "Sending your location to dispatch…"
        : lastGpsError
          ? lastGpsError
          : age
            ? `Live · last shared ${age} · every 10 min`
            : "On · sharing with Tracking Map every 10 min";

  return (
    <Card
      className={cn(
        "overflow-hidden border-border/70 shadow-sm transition-colors",
        locationSharing && activeLoad && !lastGpsError && "border-red-500/25",
      )}
    >
      <CardContent className="p-0">
        <div className="flex items-center gap-3 p-4">
          <div
            className={cn(
              "relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl",
              locationSharing
                ? "bg-red-500/12 text-red-600 dark:text-red-400"
                : "bg-muted text-muted-foreground",
            )}
          >
            {locationSharing && activeLoad && !lastGpsError ? (
              <span className="absolute inset-0 animate-ping rounded-2xl bg-red-500/20" aria-hidden />
            ) : null}
            {gpsPublishing ? (
              <Loader2 className="relative h-5 w-5 animate-spin" />
            ) : lastGpsError && locationSharing ? (
              <ShieldAlert className="relative h-5 w-5" />
            ) : (
              <MapPin className="relative h-5 w-5" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-foreground">Live location sharing</div>
            <div className="mt-0.5 text-xs leading-snug text-muted-foreground">
              {description ?? statusLine}
            </div>
          </div>
          <Switch
            checked={locationSharing}
            onCheckedChange={(next) => {
              setLocationSharing(next);
              if (next) void publishLocationNow();
            }}
            aria-label="Toggle location sharing"
          />
        </div>
        {locationSharing ? (
          <div className="flex items-center justify-between gap-2 border-t border-border/60 bg-muted/25 px-4 py-2.5">
            <p className="inline-flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
              <Navigation className="h-3 w-3 shrink-0 text-red-500" />
              <span className="truncate">
                {activeLoad
                  ? `Tracking shows a red pin for ${activeLoad.id}`
                  : "Accept a load to start sending GPS"}
              </span>
            </p>
            {activeLoad ? (
              <button
                type="button"
                className="shrink-0 text-[11px] font-semibold text-primary underline-offset-2 hover:underline disabled:opacity-50"
                disabled={gpsPublishing}
                onClick={() => void publishLocationNow()}
              >
                Share now
              </button>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
