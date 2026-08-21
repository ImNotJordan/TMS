/**
 * Presentation helpers for the inventory module.
 *
 * ## Formatting moved out
 *
 * This file used to own `Intl` formatters pinned to `en-US` and the browser's
 * time zone. It no longer formats dates, numbers or money at all: those come
 * from `useFormat()`, so the Settings choice of language and time zone actually
 * reaches the ledger. A cycle count posted at 23:30 in Shanghai is a *different
 * day* in Chicago, and a module with its own hardcoded formatters is a module
 * that quietly disagrees with the rest of the app about which day that was.
 *
 * What remains here is genuinely presentational and locale-independent: tone
 * classes, labels, search haystacks, and the CSV writer.
 */
import {
  INVENTORY_MOVEMENT_LABELS,
  type InventoryItemRecord,
  type InventoryMovementKind,
  type InventoryMovementRecord,
  type StockHealth,
} from "@/lib/inventory-domain";
import type { Formatters } from "@/lib/i18n/format";

/**
 * Signed unit delta — `+24` / `−4`.
 *
 * Takes the formatter rather than owning one so the digits and grouping follow
 * the active locale. The sign is applied outside `Intl` deliberately: a ledger
 * reads better with an explicit `+` on receipts, which `signDisplay: "always"`
 * renders inconsistently across locales.
 */
export function signedUnits(format: Formatters, value: number | undefined | null): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  return `${value > 0 ? "+" : "−"}${format.number(Math.abs(value))}`;
}

export const STOCK_HEALTH_LABELS: Record<StockHealth, string> = {
  out: "Out of stock",
  critical: "Critical",
  low: "Low",
  healthy: "Healthy",
  overstock: "Overstocked",
};

/**
 * Tones use the semantic tokens from `styles.css`, never raw palette colours, so
 * the module tracks the app's light and dark themes without its own definitions.
 */
export const STOCK_HEALTH_TONE: Record<StockHealth, string> = {
  out: "border-destructive/30 bg-destructive/10 text-destructive",
  critical: "border-destructive/30 bg-destructive/10 text-destructive",
  low: "border-warning/40 bg-warning/15 text-warning-foreground",
  healthy: "border-success/40 bg-success/15 text-success",
  overstock: "border-info/40 bg-info/15 text-info",
};

export const STOCK_HEALTH_BAR: Record<StockHealth, string> = {
  out: "bg-destructive",
  critical: "bg-destructive",
  low: "bg-warning",
  healthy: "bg-success",
  overstock: "bg-info",
};

export const MOVEMENT_TONE: Record<InventoryMovementKind, string> = {
  receipt: "border-success/40 bg-success/15 text-success",
  shipment: "border-info/40 bg-info/15 text-info",
  adjustment: "border-warning/40 bg-warning/15 text-warning-foreground",
  count: "border-primary/30 bg-primary/10 text-primary",
  allocate: "border-border bg-muted text-foreground",
  release: "border-border bg-muted text-muted-foreground",
};

export const ITEM_STATUS_TONE: Record<string, string> = {
  Active: "border-success/40 bg-success/15 text-success",
  "On Hold": "border-warning/40 bg-warning/15 text-warning-foreground",
  Discontinued: "border-border bg-muted text-muted-foreground",
  Archived: "border-border bg-muted text-muted-foreground",
};

export function movementLabel(kind: InventoryMovementKind): string {
  return INVENTORY_MOVEMENT_LABELS[kind] ?? kind;
}

/** One searchable haystack per SKU, so the filter box matches what a user would expect it to. */
export function itemSearchText(item: InventoryItemRecord): string {
  return [
    item.sku,
    item.name,
    item.description,
    item.category,
    item.warehouse,
    item.binLocation,
    item.supplierName,
    item.supplierSku,
    item.notes,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function movementSearchText(movement: InventoryMovementRecord): string {
  return [
    movement.sku,
    movement.itemName,
    movement.reference,
    movement.reason,
    movement.notes,
    movementLabel(movement.kind),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/**
 * CSV for a spreadsheet, not for a parser.
 *
 * Quotes every field and doubles embedded quotes; a leading `=`, `+`, `-` or `@`
 * is prefixed with a tab so Excel treats it as text. A SKU called `=cmd|...`
 * pasted into a colleague's spreadsheet is a formula-injection payload, and an
 * export is exactly the path that carries it there.
 */
export function toCsv(headers: string[], rows: (string | number | undefined)[][]): string {
  const cell = (value: string | number | undefined) => {
    const raw = value === undefined || value === null ? "" : String(value);
    const guarded = /^[=+\-@\t\r]/.test(raw) ? `\t${raw}` : raw;
    return `"${guarded.replace(/"/g, '""')}"`;
  };
  return [headers.map(cell).join(","), ...rows.map((row) => row.map(cell).join(","))].join("\r\n");
}

export function downloadCsv(filename: string, contents: string) {
  // Escaped rather than literal: a raw BOM in the source is invisible and
  // trips the irregular-whitespace lint. Excel needs it to read UTF-8.
  const blob = new Blob([`\ufeff${contents}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
