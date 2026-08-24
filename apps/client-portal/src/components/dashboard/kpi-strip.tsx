import { Package, Radio, Truck } from "lucide-react";

import type { ClientDashboardResponse } from "@/lib/dashboard-types";
import { formatMoney } from "@/lib/format";

export function KpiStrip({ summary }: { summary: ClientDashboardResponse["summary"] }) {
  const items = [
    { label: "Active loads", value: String(summary.activeCount), icon: Package },
    { label: "In transit", value: String(summary.inTransitCount), icon: Truck },
    { label: "Live GPS", value: String(summary.trackedCount), icon: Radio },
  ];

  return (
    <div className="grid grid-cols-3 gap-2">
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-lg border border-border/80 bg-card px-3 py-2.5 shadow-sm"
        >
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            <item.icon className="h-3 w-3" />
            {item.label}
          </div>
          <div className="mt-1 font-heading text-xl font-bold tabular-nums text-foreground">
            {item.value}
          </div>
        </div>
      ))}
      <div className="col-span-3 rounded-lg border border-sky/20 bg-sky/5 px-3 py-2">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-sky">
          Tax on active loads
        </div>
        <div className="mt-0.5 flex flex-wrap items-baseline justify-between gap-2">
          <span className="font-mono text-lg font-semibold tabular-nums text-foreground">
            {(summary.taxTotals?.length
              ? summary.taxTotals
              : [{ currency: summary.currency, amount: summary.taxTotal }]
            )
              .map((row) => formatMoney(row.amount, row.currency))
              .join(" · ")}
          </span>
          <span className="text-[11px] text-muted-foreground">
            billed {formatMoney(summary.billedTotal, summary.currency)}
          </span>
        </div>
      </div>
    </div>
  );
}
