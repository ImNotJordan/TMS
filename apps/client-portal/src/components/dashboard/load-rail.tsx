import { useEffect, useRef } from "react";
import { animate, stagger } from "animejs";
import { Radio } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { ClientDashboardLoad } from "@/lib/dashboard-types";
import { formatLane, formatMoney, formatStatus, formatWhen } from "@/lib/format";
import { cn } from "@/lib/utils";

export function LoadRail({
  loads,
  selectedId,
  onSelect,
}: {
  loads: ClientDashboardLoad[];
  selectedId: string | null;
  onSelect: (loadId: string) => void;
}) {
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const root = listRef.current;
    if (!root) return;
    const cards = root.querySelectorAll("[data-load-card]");
    if (cards.length === 0) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    animate(cards, {
      opacity: [0, 1],
      translateY: [12, 0],
      delay: stagger(55),
      duration: 380,
      ease: "out(1.4)",
    });
  }, [loads.length]);

  if (loads.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card/80 px-4 py-8 text-center">
        <p className="text-sm font-semibold text-foreground">No active shipments</p>
        <p className="mt-1 text-xs text-muted-foreground">
          When your broker assigns loads to your account, they appear here with live tracking.
        </p>
      </div>
    );
  }

  return (
    <ul ref={listRef} className="space-y-2">
      {loads.map((load) => {
        const selected = load.loadId === selectedId;
        return (
          <li key={load.loadId}>
            <button
              type="button"
              data-load-card
              onClick={() => onSelect(load.loadId)}
              className={cn(
                "w-full cursor-pointer rounded-xl border bg-card p-3 text-left shadow-sm transition-colors duration-150",
                selected ? "border-sky ring-1 ring-sky/40" : "border-border/80 hover:border-sky/40",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-mono text-xs font-semibold tracking-tight">
                    {load.loadId}
                  </div>
                  <div className="mt-0.5 truncate text-sm font-medium text-foreground">
                    {formatLane(load)}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {load.gps?.fresh ? (
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="live-pulse absolute inline-flex h-full w-full rounded-full bg-live" />
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-live" />
                    </span>
                  ) : null}
                  <Badge variant={load.gps?.fresh ? "live" : "secondary"}>
                    {formatStatus(load.trackingState || load.loadStatus)}
                  </Badge>
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                <span className="truncate">{load.customer}</span>
                <span>{load.pickupDate ? formatWhen(load.pickupDate) : "Pickup TBD"}</span>
              </div>
              <div className="mt-2 space-y-1 border-t border-border/70 pt-2 text-xs">
                {(load.tax.lines.length > 0
                  ? load.tax.lines
                  : [{ label: load.tax.label, amount: load.tax.amount, currency: load.tax.currency }]
                ).map((line) => (
                  <div key={`${line.label}-${line.currency}`} className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">{line.label}</span>
                    <span className="font-mono font-semibold tabular-nums">
                      {formatMoney(line.amount, line.currency)}
                    </span>
                  </div>
                ))}
              </div>
              {load.gps?.fresh ? (
                <div className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-live">
                  <Radio className="h-3 w-3" />
                  Live · {formatWhen(load.gps.lastPingAt)}
                </div>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
