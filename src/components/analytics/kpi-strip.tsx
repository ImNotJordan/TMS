import {
  ArrowDownRight,
  ArrowUpRight,
  type LucideIcon,
} from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { AnalyticsKpi, KpiTone } from "@/lib/analytics-kpis";

const toneAccent: Record<KpiTone, string> = {
  default: "bg-muted text-foreground",
  success: "bg-success/15 text-success",
  warning: "bg-warning/20 text-warning-foreground",
  destructive: "bg-destructive/12 text-destructive",
  info: "bg-info/15 text-info",
};

export function AnalyticsKpiStrip({
  kpis,
  onSelect,
  columns = 4,
}: {
  kpis: AnalyticsKpi[];
  onSelect?: (kpi: AnalyticsKpi) => void;
  columns?: 3 | 4 | 5 | 6;
}) {
  const grid =
    columns === 3
      ? "sm:grid-cols-2 lg:grid-cols-3"
      : columns === 5
        ? "sm:grid-cols-2 lg:grid-cols-5"
        : columns === 6
          ? "sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6"
          : "sm:grid-cols-2 lg:grid-cols-4";

  return (
    <div className={cn("grid gap-3", grid)}>
      {kpis.map((kpi) => (
        <button
          key={kpi.id}
          type="button"
          onClick={() => onSelect?.(kpi)}
          className="group text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Card className="h-full overflow-hidden border-border/70 shadow-sm transition-all group-hover:border-primary/40 group-hover:shadow-md">
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {kpi.label}
                </p>
                <span
                  className={cn(
                    "rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                    toneAccent[kpi.tone ?? "default"],
                  )}
                >
                  KPI
                </span>
              </div>
              <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground tabular-nums">
                {kpi.value}
              </p>
              {(kpi.delta || kpi.deltaLabel) && (
                <p className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
                  {kpi.trend === "up" ? (
                    <ArrowUpRight className="h-3.5 w-3.5 text-success" />
                  ) : kpi.trend === "down" ? (
                    <ArrowDownRight className="h-3.5 w-3.5 text-destructive" />
                  ) : null}
                  {kpi.delta && (
                    <span
                      className={cn(
                        "font-medium",
                        kpi.trend === "up"
                          ? "text-success"
                          : kpi.trend === "down"
                            ? "text-destructive"
                            : "text-foreground",
                      )}
                    >
                      {kpi.delta}
                    </span>
                  )}
                  {kpi.deltaLabel && <span>{kpi.deltaLabel}</span>}
                </p>
              )}
              {kpi.description && (
                <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{kpi.description}</p>
              )}
              <p className="mt-2 text-[10px] font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                Drill into events →
              </p>
            </CardContent>
          </Card>
        </button>
      ))}
    </div>
  );
}

export function AnalyticsPanelHeader({
  title,
  description,
  icon: Icon,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
}) {
  return (
    <div className="mb-4 flex items-start gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <h2 className="text-base font-semibold tracking-tight text-foreground">{title}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
