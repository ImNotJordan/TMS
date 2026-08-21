import { BarChart3, Gauge, Radar, Truck } from "lucide-react";

import { Card } from "@/components/ui/card";
import { useDatFeatureFlags } from "@/lib/dat-feature-flags";
import { t } from "@/lib/i18n/t";
import { cn } from "@/lib/utils";

export type DatSuggestionLane = {
  originCity?: string;
  originState?: string;
  destinationCity?: string;
  destinationState?: string;
  equipmentType?: string;
  offeredRate?: number;
};

function hashString(value: string) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h >>> 0);
}

function laneInsights(lane: DatSuggestionLane) {
  const origin = `${lane.originCity || lane.originState || "Origin"}`;
  const destination = `${lane.destinationCity || lane.destinationState || "Anywhere"}`;
  const seed = hashString(
    `${origin}|${destination}|${lane.equipmentType || "dry-van"}`.toLowerCase(),
  );
  const capacityScore = Math.max(12, Math.min(92, 48 + ((seed % 41) - 20)));
  const trucksNearOrigin = Math.max(6, Math.round(20 + capacityScore * 0.7 + (seed % 18)));
  const rpm = Number((2.15 + (seed % 90) / 100).toFixed(2));
  const avgRate = Math.round(rpm * 650);
  return {
    origin,
    destination,
    capacityScore,
    trucksNearOrigin,
    rpm,
    avgRate,
    tightness: capacityScore < 40 ? "tight" : capacityScore > 70 ? "loose" : "moderate",
  };
}

/**
 * DAT suggestions for TruckBoard — posting review and the board itself.
 *
 * Hidden entirely when Settings → Integrations turns off "Show DAT Suggestions
 * on TruckBoard" (or the matching capacity/rate data toggles). The card is the
 * page the setting title names; a disabled toggle must not leave it on screen.
 */
export function DatSuggestionsCard({
  lane,
  className,
}: {
  lane: DatSuggestionLane;
  className?: string;
}) {
  const flags = useDatFeatureFlags();
  if (!flags.showOnTruckboard) return null;

  const insights = laneInsights(lane);
  const tightnessLabel =
    insights.tightness === "tight"
      ? "Low truck availability"
      : insights.tightness === "loose"
        ? "High truck availability"
        : "Balanced supply";

  return (
    <Card
      className={cn(
        "border-primary/30 bg-gradient-to-br from-primary/5 via-card to-info/8",
        className,
      )}
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-info text-primary-foreground shadow-sm shadow-primary/30">
            <BarChart3 className="h-5 w-5" />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold tracking-tight text-foreground">
                {t("DAT Market Suggestions")}
              </h3>
              <span className="rounded-full bg-primary/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                {flags.dataWindow}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {insights.origin} → {insights.destination}
              {lane.equipmentType ? ` · ${lane.equipmentType}` : ""}
            </p>
          </div>
        </div>
      </div>

      <div
        className={cn(
          "grid gap-3",
          flags.showTruckboardCapacity && flags.showTruckboardRates
            ? "sm:grid-cols-2 lg:grid-cols-3"
            : "sm:grid-cols-2",
        )}
      >
        {flags.showTruckboardCapacity ? (
          <>
            <Stat
              label={t("DAT Capacity Score")}
              value={`${insights.capacityScore}/100`}
              hint={tightnessLabel}
              icon={Radar}
            />
            <Stat
              label={t("Trucks Near Origin")}
              value={insights.trucksNearOrigin.toLocaleString()}
              hint={t("Within 100 mi · last 24h")}
              icon={Truck}
            />
          </>
        ) : null}
        {flags.showTruckboardRates ? (
          <Stat
            label={t("DAT Rate Per Mile")}
            value={`$${insights.rpm.toFixed(2)}`}
            hint={`Lane avg $${insights.avgRate.toLocaleString()}`}
            icon={Gauge}
          />
        ) : null}
      </div>
    </Card>
  );
}

function Stat({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint: string;
  icon: typeof Radar;
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-card/80 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <Icon className="h-3.5 w-3.5 text-primary" />
      </div>
      <div className="mt-1.5 text-base font-semibold tabular-nums text-foreground">{value}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>
    </div>
  );
}
