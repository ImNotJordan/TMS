import { type LucideIcon, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function KpiCard({
  label,
  value,
  delta,
  deltaLabel = "vs last week",
  trend = "up",
  icon: Icon,
  accent = "primary",
  to,
}: {
  label: string;
  value: string;
  delta?: string;
  deltaLabel?: string;
  trend?: "up" | "down";
  icon: LucideIcon;
  accent?: "primary" | "success" | "warning" | "destructive" | "info";
  to?: string;
}) {
  const accentBg = {
    primary: "bg-primary/10 text-primary",
    success: "bg-success/15 text-success",
    warning: "bg-warning/20 text-warning-foreground",
    destructive: "bg-destructive/12 text-destructive",
    info: "bg-info/15 text-info",
  }[accent];
  const TrendIcon = trend === "up" ? ArrowUpRight : ArrowDownRight;
  const trendColor = trend === "up" ? "text-success" : "text-destructive";

  const body = (
    <CardContent className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{value}</p>
          {delta && (
            <p className={cn("mt-1.5 inline-flex items-center gap-1 text-xs font-medium", trendColor)}>
              <TrendIcon className="h-3.5 w-3.5" />
              {delta}
              <span className="text-muted-foreground font-normal">{deltaLabel}</span>
            </p>
          )}
        </div>
        <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", accentBg)}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </CardContent>
  );

  return (
    <Card
      className={cn(
        "overflow-hidden border-border/70 shadow-sm transition-shadow hover:shadow-md",
        to && "cursor-pointer focus-within:ring-2 focus-within:ring-primary/30",
      )}
    >
      {to ? (
        <Link to={to} className="block outline-none">
          {body}
        </Link>
      ) : (
        body
      )}
    </Card>
  );
}
