import * as React from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ClipboardCheck,
  Lock,
  MoreHorizontal,
  PackageSearch,
  PencilLine,
  Scale,
  Trash2,
  Unlock,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  availableQuantity,
  extendedCost,
  stockHealth,
  type InventoryItemRecord,
  type InventoryMovementKind,
} from "@/lib/inventory-domain";
import { ITEM_STATUS_TONE } from "@/features/inventory/inventory-format";
import { useFormat } from "@/lib/i18n/locale-context";
import { CoverageBar, EmptyState, StockHealthBadge } from "@/features/inventory/inventory-ui";
import { t } from "@/lib/i18n/t";

export type StockSortKey = "sku" | "name" | "onHand" | "available" | "value" | "health" | "updated";

export type StockTableProps = {
  items: InventoryItemRecord[];
  showValuation: boolean;
  sortKey: StockSortKey;
  sortDescending: boolean;
  onSort: (key: StockSortKey) => void;
  canEdit: boolean;
  canDelete: boolean;
  editReason: string | null;
  deleteReason: string | null;
  canPostMovement: (kind: InventoryMovementKind) => boolean;
  movementReason: (kind: InventoryMovementKind) => string | null;
  onEdit: (item: InventoryItemRecord) => void;
  onDelete: (item: InventoryItemRecord) => void;
  onMove: (item: InventoryItemRecord, kind: InventoryMovementKind) => void;
  onInspect: (item: InventoryItemRecord) => void;
  emptyAction?: React.ReactNode;
  /** True when the list is non-empty but the filters matched nothing. */
  filtered: boolean;
  /** Load ids still holding a reservation, keyed by SKU. */
  reservedLoadIds?: Map<string, string[]>;
};

const MOVEMENT_MENU: {
  kind: InventoryMovementKind;
  label: string;
  icon: typeof ArrowDownToLine;
}[] = [
  { kind: "receipt", label: "Receive stock", icon: ArrowDownToLine },
  { kind: "shipment", label: "Ship stock", icon: ArrowUpFromLine },
  { kind: "allocate", label: "Allocate to load", icon: Lock },
  { kind: "release", label: "Release allocation", icon: Unlock },
  { kind: "adjustment", label: "Adjust / write off", icon: Scale },
  { kind: "count", label: "Cycle count", icon: ClipboardCheck },
];

function SortableHead({
  label,
  sortKey,
  activeKey,
  descending,
  onSort,
  className,
  align = "left",
}: {
  label: string;
  sortKey: StockSortKey;
  activeKey: StockSortKey;
  descending: boolean;
  onSort: (key: StockSortKey) => void;
  className?: string;
  align?: "left" | "right";
}) {
  const active = activeKey === sortKey;
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "inline-flex w-full items-center gap-1 text-xs font-medium transition-colors hover:text-foreground",
          align === "right" && "justify-end",
          active ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
        <span aria-hidden className={cn("text-[10px]", !active && "opacity-0")}>
          {descending ? "▼" : "▲"}
        </span>
      </button>
    </TableHead>
  );
}

export function InventoryStockTable({
  items,
  showValuation,
  sortKey,
  sortDescending,
  onSort,
  canEdit,
  canDelete,
  editReason,
  deleteReason,
  canPostMovement,
  movementReason,
  onEdit,
  onDelete,
  onMove,
  onInspect,
  emptyAction,
  filtered,
  reservedLoadIds,
}: StockTableProps) {
  const format = useFormat();

  if (items.length === 0) {
    return (
      <EmptyState
        icon={PackageSearch}
        title={filtered ? "No SKUs match these filters" : "No inventory yet"}
        description={
          filtered
            ? "Clear a filter or widen the search to see the rest of the warehouse."
            : "Create your first SKU and post an opening receipt — stock levels are ledger-driven, so every unit has a paper trail from the start."
        }
        action={filtered ? undefined : emptyAction}
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <SortableHead
              label="SKU"
              sortKey="sku"
              activeKey={sortKey}
              descending={sortDescending}
              onSort={onSort}
              className="min-w-[150px]"
            />
            <SortableHead
              label={t("Item")}
              sortKey="name"
              activeKey={sortKey}
              descending={sortDescending}
              onSort={onSort}
              className="min-w-[200px]"
            />
            <TableHead className="min-w-[130px] text-xs">{t("Location")}</TableHead>
            <SortableHead
              label={t("On hand")}
              sortKey="onHand"
              activeKey={sortKey}
              descending={sortDescending}
              onSort={onSort}
              className="min-w-[92px] text-right"
              align="right"
            />
            <TableHead className="min-w-[92px] text-right text-xs">{t("Allocated")}</TableHead>
            <SortableHead
              label={t("Available")}
              sortKey="available"
              activeKey={sortKey}
              descending={sortDescending}
              onSort={onSort}
              className="min-w-[92px] text-right"
              align="right"
            />
            <SortableHead
              label={t("Coverage")}
              sortKey="health"
              activeKey={sortKey}
              descending={sortDescending}
              onSort={onSort}
              className="min-w-[150px]"
            />
            {showValuation ? (
              <SortableHead
                label={t("Value")}
                sortKey="value"
                activeKey={sortKey}
                descending={sortDescending}
                onSort={onSort}
                className="min-w-[110px] text-right"
                align="right"
              />
            ) : null}
            <SortableHead
              label={t("Last move")}
              sortKey="updated"
              activeKey={sortKey}
              descending={sortDescending}
              onSort={onSort}
              className="min-w-[110px]"
            />
            <TableHead className="w-[52px] text-right text-xs">
              <span className="sr-only">{t("Actions")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => {
            const health = stockHealth(item);
            const available = availableQuantity(item);
            const allocated = item.quantityAllocated ?? 0;

            return (
              <TableRow key={item.itemId} className="group">
                <TableCell className="font-medium">
                  <button
                    type="button"
                    onClick={() => onInspect(item)}
                    className="text-left font-medium text-foreground underline-offset-4 hover:underline"
                  >
                    {item.sku}
                  </button>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    <Badge
                      variant="outline"
                      className={cn(
                        "px-1.5 py-0 text-[10px] font-medium",
                        ITEM_STATUS_TONE[item.status] ?? "border-border bg-muted",
                      )}
                    >
                      {item.status}
                    </Badge>
                    {item.hazmat ? (
                      <Badge
                        variant="outline"
                        className="border-destructive/30 bg-destructive/10 px-1.5 py-0 text-[10px] font-medium text-destructive"
                      >
                        {t("Hazmat")}
                      </Badge>
                    ) : null}
                    {item.temperatureControlled ? (
                      <Badge
                        variant="outline"
                        className="border-info/40 bg-info/10 px-1.5 py-0 text-[10px] font-medium text-info"
                      >
                        {t("Reefer")}
                      </Badge>
                    ) : null}
                  </div>
                </TableCell>

                <TableCell>
                  <p className="truncate font-medium text-foreground">{item.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {item.category || "Uncategorised"}
                    {item.supplierName ? ` · ${item.supplierName}` : ""}
                  </p>
                </TableCell>

                <TableCell>
                  <p className="truncate text-sm">{item.warehouse || "Unassigned"}</p>
                  {item.binLocation ? (
                    <p className="truncate text-xs text-muted-foreground">{item.binLocation}</p>
                  ) : null}
                </TableCell>

                <TableCell className="text-right tabular-nums">
                  <span className="font-medium">{format.number(item.quantityOnHand)}</span>
                  <span className="ml-1 text-xs text-muted-foreground">
                    {item.unitOfMeasure === "Each" ? "" : item.unitOfMeasure}
                  </span>
                </TableCell>

                <TableCell className="text-right tabular-nums">
                  {allocated > 0 ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-default font-medium text-warning-foreground">
                          {format.number(allocated)}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="left" className="max-w-[240px]">
                        <p className="text-xs">
                          {t("Committed to loads — present but not sellable.")}
                        </p>
                        {(reservedLoadIds?.get(item.itemId) ?? []).length > 0 ? (
                          <p className="mt-1.5 flex flex-wrap gap-1">
                            {(reservedLoadIds?.get(item.itemId) ?? []).map((loadId) => (
                              <Link
                                key={loadId}
                                to="/loads/$loadId"
                                params={{ loadId }}
                                className="text-[11px] font-medium text-primary underline-offset-2 hover:underline"
                              >
                                {loadId}
                              </Link>
                            ))}
                          </p>
                        ) : null}
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <span className="text-muted-foreground">0</span>
                  )}
                </TableCell>

                <TableCell className="text-right tabular-nums">
                  <span
                    className={cn(
                      "font-semibold",
                      available <= 0 && "text-destructive",
                      health === "low" || health === "critical" ? "text-warning-foreground" : "",
                    )}
                  >
                    {format.number(available)}
                  </span>
                </TableCell>

                <TableCell>
                  <div className="flex items-center gap-2">
                    <CoverageBar item={item} />
                    <StockHealthBadge health={health} />
                  </div>
                </TableCell>

                {showValuation ? (
                  <TableCell className="text-right tabular-nums">
                    <p className="font-medium">{format.currency(extendedCost(item))}</p>
                    <p className="text-xs text-muted-foreground">
                      {format.currencyPrecise(item.unitCost)}/unit
                    </p>
                  </TableCell>
                ) : null}

                <TableCell>
                  <p className="text-sm">{format.relative(item.lastMovementAt)}</p>
                  {item.lastCountedAt ? (
                    <p className="text-xs text-muted-foreground">
                      Counted {format.relative(item.lastCountedAt)}
                    </p>
                  ) : null}
                </TableCell>

                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreHorizontal className="h-4 w-4" />
                        <span className="sr-only">Actions for {item.sku}</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuLabel className="text-xs">{t("Move stock")}</DropdownMenuLabel>
                      {MOVEMENT_MENU.map(({ kind, label, icon: Icon }) => {
                        const allowed = canPostMovement(kind);
                        return (
                          <DropdownMenuItem
                            key={kind}
                            disabled={!allowed}
                            onSelect={() => onMove(item, kind)}
                          >
                            <Icon className="h-3.5 w-3.5" />
                            {label}
                          </DropdownMenuItem>
                        );
                      })}
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="text-xs">{t("Catalogue")}</DropdownMenuLabel>
                      <DropdownMenuItem onSelect={() => onInspect(item)}>
                        <PackageSearch className="h-3.5 w-3.5" />
                        {t("View history")}
                      </DropdownMenuItem>
                      <DropdownMenuItem disabled={!canEdit} onSelect={() => onEdit(item)}>
                        <PencilLine className="h-3.5 w-3.5" />
                        {t("Edit item")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={!canDelete}
                        onSelect={() => onDelete(item)}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {t("Delete item")}
                      </DropdownMenuItem>
                      {!canEdit && editReason ? (
                        <p className="px-2 py-1.5 text-[11px] text-muted-foreground">
                          {editReason}
                        </p>
                      ) : !canDelete && deleteReason ? (
                        <p className="px-2 py-1.5 text-[11px] text-muted-foreground">
                          {deleteReason}
                        </p>
                      ) : !canPostMovement("adjustment") && movementReason("adjustment") ? (
                        <p className="px-2 py-1.5 text-[11px] text-muted-foreground">
                          {movementReason("adjustment")}
                        </p>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
