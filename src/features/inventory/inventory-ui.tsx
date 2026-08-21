import * as React from "react";
import { type LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useFormat } from "@/lib/i18n/locale-context";
import {
  coverageRatio,
  stockHealth,
  type InventoryItemRecord,
  type InventoryMovementKind,
  type StockHealth,
} from "@/lib/inventory-domain";
import {
  MOVEMENT_TONE,
  STOCK_HEALTH_BAR,
  STOCK_HEALTH_LABELS,
  STOCK_HEALTH_TONE,
  movementLabel,
} from "@/features/inventory/inventory-format";

export type MetricTone = "default" | "success" | "warning" | "info" | "danger";

const METRIC_TONE: Record<MetricTone, string> = {
  default: "border-border/70 bg-muted/80 text-muted-foreground",
  success: "border-success/30 bg-success/15 text-success",
  warning: "border-warning/30 bg-warning/15 text-warning-foreground",
  info: "border-info/30 bg-info/15 text-info",
  danger: "border-destructive/30 bg-destructive/10 text-destructive",
};

/**
 * Metric tile matching the bidding workspace's shape so the two pages read as
 * one product. Deliberately renders a dash rather than a zero when there is no
 * data yet — "0 SKUs" and "we have not loaded yet" are different facts.
 */
export function MetricCard({
  label,
  value,
  subtitle,
  icon: Icon,
  tone = "default",
  empty = false,
}: {
  label: string;
  value: string;
  subtitle: string;
  icon: LucideIcon;
  tone?: MetricTone;
  empty?: boolean;
}) {
  return (
    <Card className="min-w-0 overflow-hidden border-border/70 bg-card shadow-sm transition-shadow hover:shadow-md">
      <CardContent className="flex h-full flex-col p-4">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <span
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border",
              METRIC_TONE[tone],
            )}
          >
            <Icon className="h-4 w-4" />
          </span>
        </div>

        <div className="mt-3 min-h-[2.25rem]">
          {empty ? (
            <p className="text-2xl font-semibold leading-none text-muted-foreground/70">—</p>
          ) : (
            <p className="truncate text-2xl font-semibold leading-none tracking-tight">{value}</p>
          )}
        </div>

        <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {subtitle}
        </p>
      </CardContent>
    </Card>
  );
}

export function StockHealthBadge({ health }: { health: StockHealth }) {
  return (
    <Badge variant="outline" className={cn("font-medium", STOCK_HEALTH_TONE[health])}>
      {STOCK_HEALTH_LABELS[health]}
    </Badge>
  );
}

export function MovementKindBadge({ kind }: { kind: InventoryMovementKind }) {
  return (
    <Badge variant="outline" className={cn("font-medium", MOVEMENT_TONE[kind])}>
      {movementLabel(kind)}
    </Badge>
  );
}

/**
 * Coverage against the reorder point.
 *
 * The bar is filled from *available* stock, and the marker sits at the reorder
 * point — so "we hold plenty but it is all promised" reads as a problem, which
 * is what it is. A bar drawn from on-hand would show that case as healthy right
 * up until the next order could not be filled.
 */
export function CoverageBar({
  item,
}: {
  item: Pick<InventoryItemRecord, "quantityOnHand" | "quantityAllocated" | "reorderPoint">;
}) {
  const format = useFormat();
  const health = stockHealth(item);
  const ratio = coverageRatio(item);
  const hasReorderPoint = (item.reorderPoint ?? 0) > 0;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex w-full min-w-[84px] items-center gap-2" aria-hidden>
          <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn("h-full rounded-full transition-all", STOCK_HEALTH_BAR[health])}
              style={{ width: `${Math.max(ratio * 100, ratio > 0 ? 4 : 0)}%` }}
            />
            {hasReorderPoint ? (
              // The reorder point sits at the midpoint by construction:
              // coverageRatio scales against 2× the reorder point.
              <span className="absolute inset-y-0 left-1/2 w-px bg-foreground/40" />
            ) : null}
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top">
        <p className="text-xs">
          {hasReorderPoint
            ? `Reorder at ${format.number(item.reorderPoint)} · ${STOCK_HEALTH_LABELS[health]}`
            : `No reorder point set · ${STOCK_HEALTH_LABELS[health]}`}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

/** Notice strip in the house style. `tone` maps to the semantic tokens. */
export function NoticeStrip({
  tone = "muted",
  children,
  className,
}: {
  tone?: "muted" | "warning" | "danger";
  children: React.ReactNode;
  className?: string;
}) {
  const toneClass =
    tone === "danger"
      ? "border-destructive/30 bg-destructive/10 text-destructive"
      : tone === "warning"
        ? "border-warning/30 bg-warning/10 text-warning-foreground"
        : "border-border/70 bg-muted/20 text-muted-foreground";

  return (
    <div className={cn("rounded-lg border px-3 py-2.5 text-sm", toneClass, className)}>
      {children}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Icon className="h-6 w-6" />
      </div>
      <div className="max-w-md">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}

/**
 * Wraps a control the server would refuse, so the reason is visible before the
 * click rather than as a toast after it. `asChild` on the trigger keeps the
 * tooltip attached to a disabled button, which otherwise swallows pointer events.
 */
export function DisabledReason({
  reason,
  children,
}: {
  reason: string | null;
  children: React.ReactNode;
}) {
  if (!reason) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex cursor-not-allowed">{children}</span>
      </TooltipTrigger>
      <TooltipContent side="top">
        <p className="max-w-[220px] text-xs">{reason}</p>
      </TooltipContent>
    </Tooltip>
  );
}
