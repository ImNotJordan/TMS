import { AlertTriangle, Boxes, Warehouse } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  isBelowReorder,
  rollupByWarehouse,
  type InventoryItemRecord,
} from "@/lib/inventory-domain";

import { useFormat } from "@/lib/i18n/locale-context";
import { EmptyState } from "@/features/inventory/inventory-ui";
import { t } from "@/lib/i18n/t";

/**
 * Per-warehouse rollup.
 *
 * Locations are derived from the SKUs that sit in them rather than kept in a
 * table of their own. One less thing to provision, one less place for a
 * warehouse to exist in the list and nowhere else — and the moment a location
 * genuinely needs its own attributes (dock doors, operating hours, a carrier
 * contact), promoting it to a table is a migration rather than a rewrite.
 */
export function InventoryLocationsPanel({
  items,
  showValuation,
  onSelectWarehouse,
  activeWarehouse,
}: {
  items: InventoryItemRecord[];
  showValuation: boolean;
  onSelectWarehouse: (warehouse: string) => void;
  activeWarehouse: string;
}) {
  const format = useFormat();
  const rollups = rollupByWarehouse(items);

  if (rollups.length === 0) {
    return (
      <EmptyState
        icon={Warehouse}
        title={t("No locations yet")}
        description={t("Warehouses appear here as soon as SKUs are assigned to them.")}
      />
    );
  }

  const totalUnits = rollups.reduce((sum, row) => sum + row.onHandUnits, 0);

  return (
    <div className="grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-3">
      {rollups.map((row) => {
        const share = totalUnits > 0 ? row.onHandUnits / totalUnits : 0;
        const active = activeWarehouse === row.warehouse;
        const lowSkus = items.filter(
          (item) =>
            (item.warehouse?.trim() || "Unassigned") === row.warehouse && isBelowReorder(item),
        );

        return (
          <Card
            key={row.warehouse}
            className={cn(
              "min-w-0 border-border/70 shadow-sm transition-shadow hover:shadow-md",
              active && "border-primary/50 ring-1 ring-primary/20",
            )}
          >
            <CardHeader className="space-y-0 pb-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Warehouse className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <CardTitle className="truncate text-base">{row.warehouse}</CardTitle>
                    <CardDescription className="mt-0.5">
                      {row.skuCount} {row.skuCount === 1 ? "SKU" : "SKUs"}
                      {showValuation ? ` · ${format.compactCurrency(row.costValue)}` : ""}
                    </CardDescription>
                  </div>
                </div>
                {row.belowReorderCount > 0 ? (
                  <Badge
                    variant="outline"
                    className="shrink-0 border-warning/40 bg-warning/15 font-medium text-warning-foreground"
                  >
                    <AlertTriangle className="mr-1 h-3 w-3" />
                    {row.belowReorderCount} low
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="shrink-0 border-success/40 bg-success/15 font-medium text-success"
                  >
                    {t("Stocked")}
                  </Badge>
                )}
              </div>
            </CardHeader>

            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-2">
                <Stat label={t("On hand")} value={format.number(row.onHandUnits)} />
                <Stat label={t("Allocated")} value={format.number(row.allocatedUnits)} />
                <Stat label={t("Available")} value={format.number(row.availableUnits)} />
              </div>

              <div>
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>{t("Share of units")}</span>
                  <span className="tabular-nums">{Math.round(share * 100)}%</span>
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${Math.max(share * 100, share > 0 ? 3 : 0)}%` }}
                  />
                </div>
              </div>

              {showValuation ? (
                <p className="text-sm">
                  <span className="text-muted-foreground">{t("Stock at cost")}</span>{" "}
                  <span className="font-semibold">{format.currency(row.costValue)}</span>
                </p>
              ) : null}

              {lowSkus.length > 0 ? (
                <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-warning-foreground">
                    {t("Needs replenishment")}
                  </p>
                  <p className="mt-1 line-clamp-2 text-xs text-warning-foreground/90">
                    {lowSkus
                      .slice(0, 4)
                      .map((item) => item.sku)
                      .join(", ")}
                    {lowSkus.length > 4 ? ` +${lowSkus.length - 4} more` : ""}
                  </p>
                </div>
              ) : null}

              <button
                type="button"
                onClick={() => onSelectWarehouse(active ? "all" : row.warehouse)}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-primary underline-offset-4 hover:underline"
              >
                <Boxes className="h-3.5 w-3.5" />
                {active ? "Clear filter" : "Filter stock to this location"}
              </button>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 truncate text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}
