import { Flag, MapPin, Package, Truck } from "lucide-react";

import { cn } from "@/lib/utils";

type Stage = {
  key: string;
  label: string;
  icon: typeof MapPin;
  threshold: number;
};

function buildStages(originLabel: string, destinationLabel: string): Stage[] {
  return [
    { key: "origin", label: originLabel, icon: MapPin, threshold: 0 },
    { key: "shipped", label: "Shipped", icon: Package, threshold: 33 },
    { key: "transit", label: "In transit", icon: Truck, threshold: 66 },
    { key: "destination", label: destinationLabel, icon: Flag, threshold: 100 },
  ];
}

function formatDuration(totalMinutes: number) {
  const clamped = Math.max(0, Math.round(totalMinutes));
  if (clamped < 1) return "Just now";
  const days = Math.floor(clamped / 1440);
  const hours = Math.floor((clamped % 1440) / 60);
  const minutes = clamped % 60;
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (days || hours) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(" ");
}

export function ShipmentProgressTracker({
  orderId,
  originLabel,
  destinationLabel,
  progress,
  nextStepLabel,
  statusElapsedMinutes,
  statusLabel = "In transit",
}: {
  orderId: string;
  originLabel: string;
  destinationLabel: string;
  /** 0–100. Read-only — only advances when the driver marks the next status. */
  progress: number;
  nextStepLabel: string;
  statusElapsedMinutes: number;
  statusLabel?: string;
}) {
  const clamped = Math.min(100, Math.max(0, progress));
  const stages = buildStages(originLabel, destinationLabel);

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber/15 px-2.5 py-1 text-xs font-semibold text-amber-dim">
          <Truck className="h-3.5 w-3.5" />
          {statusLabel}
        </span>
        <span className="font-mono text-xs text-muted-foreground">Order #{orderId}</span>
      </div>

      <div className="mt-7 px-3.5">
        <div className="relative h-14">
          <div className="absolute left-0 right-0 top-3.5 h-0.5 -translate-y-1/2 rounded-full border-t border-dashed border-border" />
          <div
            className="absolute left-0 top-3.5 h-0.5 -translate-y-1/2 rounded-full bg-amber transition-[width] duration-300 ease-out"
            style={{ width: `${clamped}%` }}
          />
          <div
            className="absolute top-3.5 -translate-x-1/2 -translate-y-1/2 transition-[left] duration-300 ease-out"
            style={{ left: `${clamped}%` }}
          >
            <span className="block h-2.5 w-2.5 rounded-full bg-amber ring-2 ring-card" />
          </div>

          {stages.map((stage) => {
            const reached = clamped >= stage.threshold;
            const Icon = stage.icon;
            return (
              <div
                key={stage.key}
                className="absolute top-0 flex w-14 -translate-x-1/2 flex-col items-center gap-1.5"
                style={{ left: `${stage.threshold}%` }}
              >
                <div
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-full border-2",
                    reached
                      ? "border-amber bg-amber text-ink"
                      : "border-border bg-muted text-muted-foreground",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <span className="whitespace-nowrap text-[11px] text-muted-foreground">
                  {stage.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-8 flex items-center justify-between">
        <span className="text-sm text-muted-foreground">Progress</span>
        <span className="font-mono text-sm font-semibold text-foreground">
          {Math.round(clamped)}%
        </span>
      </div>
      <div
        role="progressbar"
        aria-label="Shipment progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(clamped)}
        className="relative mt-2 h-1.5 w-full rounded-full bg-border"
      >
        <div
          className="h-full rounded-full bg-amber transition-[width] duration-300 ease-out"
          style={{ width: `${clamped}%` }}
        />
        <span
          className="absolute top-1/2 h-3 w-3 -translate-y-1/2 -translate-x-1/2 rounded-full bg-amber"
          style={{ left: `${clamped}%` }}
        />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-muted p-3">
          <div className="text-xs text-muted-foreground">Next step</div>
          <div className="mt-1 truncate font-mono text-lg font-semibold text-foreground">
            {nextStepLabel}
          </div>
        </div>
        <div className="rounded-xl bg-muted p-3">
          <div className="text-xs text-muted-foreground">Time in status</div>
          <div className="mt-1 font-mono text-lg font-semibold text-foreground">
            {formatDuration(statusElapsedMinutes)}
          </div>
        </div>
      </div>
    </div>
  );
}
