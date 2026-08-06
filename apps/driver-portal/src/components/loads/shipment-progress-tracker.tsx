import { useEffect, useState } from "react";
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
  onProgressPreview,
}: {
  orderId: string;
  originLabel: string;
  destinationLabel: string;
  /** 0–100, controlled by the caller; the slider only previews this locally. */
  progress: number;
  nextStepLabel: string;
  statusElapsedMinutes: number;
  statusLabel?: string;
  onProgressPreview?: (progress: number) => void;
}) {
  const [preview, setPreview] = useState(progress);

  useEffect(() => {
    setPreview(progress);
  }, [progress]);

  const clamped = Math.min(100, Math.max(0, preview));
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
      <input
        type="range"
        min={0}
        max={100}
        value={clamped}
        onChange={(event) => {
          const next = Number(event.target.value);
          setPreview(next);
          onProgressPreview?.(next);
        }}
        aria-label="Shipment progress"
        className={cn(
          "mt-2 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-border accent-amber",
          "[&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none",
          "[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-0 [&::-webkit-slider-thumb]:bg-amber",
          "[&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full",
          "[&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-amber",
        )}
      />

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
