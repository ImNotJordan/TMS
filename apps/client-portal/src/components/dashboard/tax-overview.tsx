import type { ClientDashboardLoad, ClientDashboardResponse } from "@/lib/dashboard-types";
import { formatMoney } from "@/lib/format";

export function TaxOverview({
  summary,
  loads,
}: {
  summary: ClientDashboardResponse["summary"];
  loads: ClientDashboardLoad[];
}) {
  const byLabel = new Map<string, { amount: number; currency: string }>();
  for (const load of loads) {
    const rows =
      load.tax.lines.length > 0
        ? load.tax.lines
        : [{ label: load.tax.label || load.tax.regime, amount: load.tax.amount, currency: load.tax.currency }];
    for (const row of rows) {
      const key = `${row.label}·${row.currency}`;
      const current = byLabel.get(key);
      if (current) current.amount += row.amount;
      else byLabel.set(key, { amount: row.amount, currency: row.currency });
    }
  }
  const rows = [...byLabel.entries()]
    .map(([key, value]) => ({
      label: key.split("·")[0] ?? key,
      ...value,
    }))
    .sort((a, b) => b.amount - a.amount);

  const totals = summary.taxTotals?.length
    ? summary.taxTotals
    : [{ currency: summary.currency, amount: summary.taxTotal }];

  return (
    <section className="rounded-xl border border-border/80 bg-card p-3 shadow-sm">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Tax overview
        </h2>
        <div className="text-right font-mono text-sm font-semibold tabular-nums">
          {totals.map((row) => (
            <div key={row.currency}>{formatMoney(row.amount, row.currency)}</div>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">No taxable active shipments.</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {rows.map((row) => (
            <li key={`${row.label}-${row.currency}`} className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate text-muted-foreground">{row.label}</span>
              <span className="font-mono tabular-nums text-foreground">
                {formatMoney(row.amount, row.currency)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
        Figures are estimates or amounts your broker entered. They are not a tax filing.
      </p>
    </section>
  );
}
