import * as React from "react";
import { Boxes, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FancySelect } from "@/components/loads/fancy-select";
import { availableQuantity, type InventoryItemRecord } from "@/lib/inventory-domain";
import {
  newLoadInventoryLineId,
  summarizeLoadInventoryLines,
  type LoadInventoryLine,
} from "@/lib/load-inventory";
import { t } from "@/lib/i18n/t";

/**
 * McLeod-style freight lines: pick warehouse SKUs onto the load.
 *
 * Saving the load posts the ledger movements. This editor only names what should
 * move — it never writes quantities itself.
 */
export function LoadInventoryLinesEditor({
  lines,
  items,
  loading,
  onChange,
  disabled,
}: {
  lines: LoadInventoryLine[];
  items: InventoryItemRecord[];
  loading?: boolean;
  onChange: (lines: LoadInventoryLine[]) => void;
  disabled?: boolean;
}) {
  const itemById = React.useMemo(() => new Map(items.map((item) => [item.itemId, item])), [items]);
  const chosen = new Set(lines.map((line) => line.itemId));
  const options = items
    .filter((item) => item.status === "Active" && !chosen.has(item.itemId))
    .map((item) => ({
      value: item.itemId,
      label: `${item.sku} · ${item.name}`,
      description: `${item.warehouse} · ${availableQuantity(item).toLocaleString()} available`,
      group: item.warehouse || "Unassigned",
    }));

  const addItem = (itemId: string) => {
    const item = itemById.get(itemId);
    if (!item) return;
    onChange([
      ...lines,
      {
        lineId: newLoadInventoryLineId(),
        itemId: item.itemId,
        sku: item.sku,
        itemName: item.name,
        warehouse: item.warehouse,
        unitOfMeasure: item.unitOfMeasure,
        quantity: 1,
        weightPerUnitLb: item.weightPerUnitLb,
      },
    ]);
  };

  const patchLine = (lineId: string, quantity: number) => {
    onChange(
      lines.map((line) =>
        line.lineId === lineId
          ? { ...line, quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 0 }
          : line,
      ),
    );
  };

  const removeLine = (lineId: string) => {
    onChange(lines.filter((line) => line.lineId !== lineId));
  };

  const summary = summarizeLoadInventoryLines(lines);

  return (
    <div className="space-y-3">
      {lines.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-3 py-3 text-sm text-muted-foreground">
          {t(
            "Pull SKUs from inventory onto this load. Booking reserves warehouse stock; pickup ships it.",
          )}
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border/70">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">{t("SKU")}</th>
                <th className="px-3 py-2 font-medium">{t("Warehouse")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("Available")}</th>
                <th className="w-[120px] px-3 py-2 text-right font-medium">{t("Qty")}</th>
                <th className="w-10 px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const item = itemById.get(line.itemId);
                const available = item ? availableQuantity(item) : null;
                const over = available !== null && line.quantity > available;
                return (
                  <tr key={line.lineId} className="border-t border-border/60">
                    <td className="px-3 py-2">
                      <p className="font-medium text-foreground">{line.sku}</p>
                      <p className="text-xs text-muted-foreground">{line.itemName}</p>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{line.warehouse || "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {available === null ? "—" : available.toLocaleString()}
                      {line.unitOfMeasure && line.unitOfMeasure !== "Each"
                        ? ` ${line.unitOfMeasure}`
                        : ""}
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        inputMode="decimal"
                        disabled={disabled}
                        value={line.quantity || ""}
                        onChange={(e) => patchLine(line.lineId, Number(e.target.value))}
                        className={over ? "border-destructive/60 text-right" : "text-right"}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={disabled}
                        onClick={() => removeLine(line.lineId)}
                        aria-label={t("Remove SKU")}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[240px] flex-1">
          <FancySelect
            value=""
            onChange={addItem}
            options={options}
            disabled={disabled || loading}
            triggerIcon={loading ? undefined : Plus}
            placeholder={
              loading
                ? t("Loading inventory…")
                : options.length === 0
                  ? t("No available SKUs")
                  : t("Add inventory SKU")
            }
            emptyMessage={t("No matching SKUs")}
          />
        </div>
        {summary.pieces > 0 ? (
          <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Boxes className="h-3.5 w-3.5" />
            {summary.pieces.toLocaleString()} {t("units")}
            {summary.weightLb > 0 ? ` · ${Math.round(summary.weightLb).toLocaleString()} lb` : ""}
          </p>
        ) : null}
      </div>
    </div>
  );
}
