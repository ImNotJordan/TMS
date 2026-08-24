/**
 * Inventory workspace.
 *
 * Three views over two tenant-scoped tables: the SKU catalogue with live stock,
 * the movement ledger behind it, and a per-warehouse rollup derived from the
 * SKUs themselves.
 *
 * ## Stock is never edited, only moved
 *
 * There is no editable quantity field anywhere on this page, and that is the
 * design rather than an omission. Every level comes from a posted movement, so
 * the ledger and the on-hand figure cannot disagree — see `inventory-proxy`. The
 * "Record movement" dialog previews the outcome using `applyMovement`, the same
 * function the server authorizes with, so the preview cannot promise something
 * the API then refuses.
 *
 * ## Permissions show up as reasons, not as absences
 *
 * `useInventoryAccess` mirrors the server's gates so a control the API would
 * refuse is disabled with the reason attached. The mirror is a courtesy; the
 * boundary is in `module-access` and `inventory-permissions`.
 */
import * as React from "react";
import {
  AlertTriangle,
  Boxes,
  CircleDollarSign,
  Download,
  History,
  Layers,
  PackagePlus,
  RefreshCw,
  Search,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
  Warehouse,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-header";
import { usePageReady } from "@/components/page-load-gate";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useOperationalList } from "@/hooks/use-operational-list";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import {
  INVENTORY_CATEGORIES,
  INVENTORY_ITEM_STATUSES,
  INVENTORY_MOVEMENT_KINDS,
  availableQuantity,
  extendedCost,
  isBelowReorder,
  movementTotals,
  stockHealth,
  summarizeInventory,
  type InventoryItemRecord,
  type InventoryMovementKind,
  type InventoryMovementRecord,
} from "@/lib/inventory-domain";
import { reservedLoadIdsByItem } from "@/lib/load-inventory";
import {
  ResourceApiError,
  createInventoryItem,
  deleteInventoryItem,
  listInventoryItemsCached,
  listInventoryMovementsCached,
  recordInventoryMovement,
  updateInventoryItem,
} from "@/lib/inventory-store";
import {
  downloadCsv,
  itemSearchText,
  movementLabel,
  movementSearchText,
  toCsv,
} from "@/features/inventory/inventory-format";
import { useFormat } from "@/lib/i18n/locale-context";
import { MetricCard, NoticeStrip } from "@/features/inventory/inventory-ui";
import { InventoryStockTable, type StockSortKey } from "@/features/inventory/inventory-stock-table";
import { InventoryMovementsTable } from "@/features/inventory/inventory-movements-table";
import { InventoryLocationsPanel } from "@/features/inventory/inventory-locations-panel";
import { InventoryItemDialog } from "@/features/inventory/inventory-item-dialog";
import { InventoryMovementDialog } from "@/features/inventory/inventory-movement-dialog";
import {
  emptyItemForm,
  emptyMovementForm,
  itemToForm,
  type ItemFormState,
  type MovementFormState,
} from "@/features/inventory/inventory-forms";
import { useInventoryAccess } from "@/features/inventory/use-inventory-access";
import { t } from "@/lib/i18n/t";

const ALL = "all";

/** Rolling window for the movement-velocity tiles. */
const VELOCITY_WINDOW_DAYS = 30;

type StockFilters = {
  search: string;
  warehouse: string;
  category: string;
  status: string;
  lowStockOnly: boolean;
};

const EMPTY_FILTERS: StockFilters = {
  search: "",
  warehouse: ALL,
  category: ALL,
  status: ALL,
  lowStockOnly: false,
};

function toNumber(value: string, fallback = 0): number {
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ResourceApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

export function InventoryPage() {
  const { user } = useAuth();
  const access = useInventoryAccess();
  // Every date, quantity and money figure below follows the workspace's
  // language and time zone from Settings, not the viewer's browser.
  const format = useFormat();

  const items = useOperationalList<InventoryItemRecord>({
    queryKey: ["inventory-items", user?.userId ?? "anon"],
    fetchList: ({ force }) => listInventoryItemsCached({ force }),
    errorMessage: "Failed to load inventory.",
  });

  const movements = useOperationalList<InventoryMovementRecord>({
    queryKey: ["inventory-movements", user?.userId ?? "anon"],
    fetchList: ({ force }) => listInventoryMovementsCached({ force }),
    errorMessage: "Failed to load the stock ledger.",
  });

  usePageReady(items.loading, "inventory");

  // Memoized rather than inlined: `items.items ?? []` allocates a fresh array on
  // every render while loading, which would invalidate every useMemo below it.
  const itemList = React.useMemo(() => items.items ?? [], [items.items]);
  const movementList = React.useMemo(() => movements.items ?? [], [movements.items]);
  const reservedLoadIds = React.useMemo(
    () => reservedLoadIdsByItem(movementList),
    [movementList],
  );

  /* ---------------------------------------------------------------- *
   * Filters, sorting
   * ---------------------------------------------------------------- */

  const [filters, setFilters] = React.useState<StockFilters>(EMPTY_FILTERS);
  const [sortKey, setSortKey] = React.useState<StockSortKey>("health");
  const [sortDescending, setSortDescending] = React.useState(false);
  const [tab, setTab] = React.useState("stock");

  const [movementSearch, setMovementSearch] = React.useState("");
  const [movementKindFilter, setMovementKindFilter] = React.useState<string>(ALL);
  const [ledgerItemId, setLedgerItemId] = React.useState<string | null>(null);

  const warehouses = React.useMemo(() => {
    const set = new Set<string>();
    for (const item of itemList) set.add(item.warehouse?.trim() || "Unassigned");
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [itemList]);

  const categories = React.useMemo(() => {
    const set = new Set<string>(INVENTORY_CATEGORIES);
    for (const item of itemList) if (item.category?.trim()) set.add(item.category.trim());
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [itemList]);

  const filteredItems = React.useMemo(() => {
    const needle = filters.search.trim().toLowerCase();
    return itemList.filter((item) => {
      if (needle && !itemSearchText(item).includes(needle)) return false;
      if (
        filters.warehouse !== ALL &&
        (item.warehouse?.trim() || "Unassigned") !== filters.warehouse
      ) {
        return false;
      }
      if (filters.category !== ALL && (item.category?.trim() || "") !== filters.category) {
        return false;
      }
      if (filters.status !== ALL && item.status !== filters.status) return false;
      if (filters.lowStockOnly && !isBelowReorder(item)) return false;
      return true;
    });
  }, [filters, itemList]);

  const sortedItems = React.useMemo(() => {
    // Health ascending puts the SKUs that need attention at the top, which is
    // the only ordering a warehouse actually opens this page for.
    const healthRank: Record<string, number> = {
      out: 0,
      critical: 1,
      low: 2,
      healthy: 3,
      overstock: 4,
    };

    const compare = (a: InventoryItemRecord, b: InventoryItemRecord): number => {
      switch (sortKey) {
        case "sku":
          return a.sku.localeCompare(b.sku);
        case "name":
          return a.name.localeCompare(b.name);
        case "onHand":
          return (a.quantityOnHand ?? 0) - (b.quantityOnHand ?? 0);
        case "available":
          return availableQuantity(a) - availableQuantity(b);
        case "value":
          return extendedCost(a) - extendedCost(b);
        case "updated":
          return (a.lastMovementAt ?? a.updatedAt ?? "").localeCompare(
            b.lastMovementAt ?? b.updatedAt ?? "",
          );
        case "health":
        default:
          return (
            healthRank[stockHealth(a)] - healthRank[stockHealth(b)] ||
            availableQuantity(a) - availableQuantity(b)
          );
      }
    };

    const sorted = [...filteredItems].sort(compare);
    return sortDescending ? sorted.reverse() : sorted;
  }, [filteredItems, sortDescending, sortKey]);

  const filteredMovements = React.useMemo(() => {
    const needle = movementSearch.trim().toLowerCase();
    return movementList.filter((movement) => {
      if (ledgerItemId && movement.itemId !== ledgerItemId) return false;
      if (movementKindFilter !== ALL && movement.kind !== movementKindFilter) return false;
      if (needle && !movementSearchText(movement).includes(needle)) return false;
      return true;
    });
  }, [ledgerItemId, movementKindFilter, movementList, movementSearch]);

  const summary = React.useMemo(() => summarizeInventory(itemList), [itemList]);

  const velocity = React.useMemo(() => {
    const since = new Date(Date.now() - VELOCITY_WINDOW_DAYS * 86_400_000).toISOString();
    return movementTotals(movementList, since);
  }, [movementList]);

  const unsettledCount = React.useMemo(
    () => movementList.filter((movement) => movement.postedState !== "posted").length,
    [movementList],
  );

  const handleSort = (key: StockSortKey) => {
    if (key === sortKey) {
      setSortDescending((prev) => !prev);
      return;
    }
    setSortKey(key);
    // Names read better ascending; quantities and money read better descending.
    setSortDescending(
      key === "onHand" || key === "available" || key === "value" || key === "updated",
    );
  };

  const filtersActive =
    filters.search.trim() !== "" ||
    filters.warehouse !== ALL ||
    filters.category !== ALL ||
    filters.status !== ALL ||
    filters.lowStockOnly;

  /* ---------------------------------------------------------------- *
   * Item dialog
   * ---------------------------------------------------------------- */

  const [itemDialogOpen, setItemDialogOpen] = React.useState(false);
  const [itemDialogMode, setItemDialogMode] = React.useState<"create" | "edit">("create");
  const [editingItemId, setEditingItemId] = React.useState<string | null>(null);
  const [itemForm, setItemForm] = React.useState<ItemFormState>(() => emptyItemForm("Unassigned"));
  const [itemSaving, setItemSaving] = React.useState(false);
  const [itemError, setItemError] = React.useState<string | null>(null);

  const openCreateItem = () => {
    setItemDialogMode("create");
    setEditingItemId(null);
    setItemForm(emptyItemForm(filters.warehouse !== ALL ? filters.warehouse : "Unassigned"));
    setItemError(null);
    setItemDialogOpen(true);
  };

  const openEditItem = (item: InventoryItemRecord) => {
    setItemDialogMode("edit");
    setEditingItemId(item.itemId);
    setItemForm(itemToForm(item));
    setItemError(null);
    setItemDialogOpen(true);
  };

  const submitItem = async () => {
    setItemSaving(true);
    setItemError(null);

    // Valuation fields are omitted entirely when the user is not entitled to
    // them. Sending 0 would zero out a cost an accountant had set.
    const valuation = access.canValueInventory
      ? { unitCost: toNumber(itemForm.unitCost), unitPrice: toNumber(itemForm.unitPrice) }
      : {};

    const payload = {
      sku: itemForm.sku.trim(),
      name: itemForm.name.trim(),
      description: itemForm.description.trim(),
      category: itemForm.category,
      warehouse: itemForm.warehouse.trim() || "Unassigned",
      binLocation: itemForm.binLocation.trim(),
      unitOfMeasure: itemForm.unitOfMeasure,
      reorderPoint: toNumber(itemForm.reorderPoint),
      reorderQuantity: toNumber(itemForm.reorderQuantity),
      supplierName: itemForm.supplierName.trim(),
      supplierSku: itemForm.supplierSku.trim(),
      hazmat: itemForm.hazmat,
      temperatureControlled: itemForm.temperatureControlled,
      temperatureRange: itemForm.temperatureRange.trim(),
      weightPerUnitLb: toNumber(itemForm.weightPerUnitLb),
      status: itemForm.status,
      notes: itemForm.notes.trim(),
      ...valuation,
    };

    try {
      if (itemDialogMode === "edit" && editingItemId) {
        const updated = await updateInventoryItem(editingItemId, payload);
        items.setItems((prev) =>
          (prev ?? []).map((row) => (row.itemId === updated.itemId ? updated : row)),
        );
        toast.success(`${updated.sku} updated`);
      } else {
        const created = await createInventoryItem(payload);
        let latest = created;

        const opening = toNumber(itemForm.openingQuantity);
        if (opening > 0) {
          // Opening stock is a receipt, so day one has a ledger row like every
          // day after it. A failure here leaves a real SKU at zero rather than
          // rolling back the create — the SKU is still the useful artifact.
          try {
            const result = await recordInventoryMovement({
              itemId: created.itemId,
              kind: "receipt",
              quantity: opening,
              reason: "Opening balance",
            });
            latest = result.item;
            movements.setItems((prev) => [result.movement, ...(prev ?? [])]);
          } catch (err) {
            toast.warning(
              `${created.sku} was created, but the opening receipt failed: ${errorMessage(
                err,
                "post it from the row menu.",
              )}`,
            );
          }
        }

        items.setItems((prev) => [latest, ...(prev ?? [])]);
        toast.success(`${created.sku} created`);
      }
      setItemDialogOpen(false);
    } catch (err) {
      setItemError(errorMessage(err, "Could not save the item."));
    } finally {
      setItemSaving(false);
    }
  };

  /* ---------------------------------------------------------------- *
   * Movement dialog
   * ---------------------------------------------------------------- */

  const [movementDialogOpen, setMovementDialogOpen] = React.useState(false);
  const [movementItem, setMovementItem] = React.useState<InventoryItemRecord | null>(null);
  const [movementForm, setMovementForm] = React.useState<MovementFormState>(() =>
    emptyMovementForm(),
  );
  const [movementSaving, setMovementSaving] = React.useState(false);
  const [movementError, setMovementError] = React.useState<string | null>(null);

  const allowedKinds = React.useMemo(
    () => new Set(INVENTORY_MOVEMENT_KINDS.filter((kind) => access.canPostMovement(kind))),
    [access],
  );

  const movementKindReason = React.useCallback(
    (kind: InventoryMovementKind) =>
      access.denyReason(kind === "adjustment" || kind === "count" ? "adjust" : "move"),
    [access],
  );

  const openMovement = (item: InventoryItemRecord, kind: InventoryMovementKind) => {
    setMovementItem(item);
    setMovementForm(emptyMovementForm(allowedKinds.has(kind) ? kind : "receipt"));
    setMovementError(null);
    setMovementDialogOpen(true);
  };

  const submitMovement = async () => {
    if (!movementItem) return;
    setMovementSaving(true);
    setMovementError(null);
    try {
      const result = await recordInventoryMovement({
        itemId: movementItem.itemId,
        kind: movementForm.kind,
        quantity: Number(movementForm.quantity),
        reason: movementForm.reason.trim() || undefined,
        reference: movementForm.reference.trim() || undefined,
        notes: movementForm.notes.trim() || undefined,
      });

      items.setItems((prev) =>
        (prev ?? []).map((row) => (row.itemId === result.item.itemId ? result.item : row)),
      );
      movements.setItems((prev) => [result.movement, ...(prev ?? [])]);
      setMovementDialogOpen(false);
      toast.success(
        `${movementLabel(result.movement.kind)} posted — ${result.item.sku} now at ${format.number(
          result.item.quantityOnHand,
        )} on hand`,
      );
    } catch (err) {
      setMovementError(errorMessage(err, "Could not post the movement."));
    } finally {
      setMovementSaving(false);
    }
  };

  /* ---------------------------------------------------------------- *
   * Delete
   * ---------------------------------------------------------------- */

  const [pendingDelete, setPendingDelete] = React.useState<InventoryItemRecord | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteInventoryItem(pendingDelete.itemId);
      items.setItems((prev) => (prev ?? []).filter((row) => row.itemId !== pendingDelete.itemId));
      toast.success(`${pendingDelete.sku} deleted`);
      setPendingDelete(null);
    } catch (err) {
      // The server refuses a delete on a SKU that still holds stock, and says so
      // — surfacing that message beats a generic failure.
      toast.error(errorMessage(err, "Could not delete the item."));
    } finally {
      setDeleting(false);
    }
  };

  /* ---------------------------------------------------------------- *
   * Ledger navigation + export
   * ---------------------------------------------------------------- */

  const inspectItem = (item: InventoryItemRecord) => {
    setLedgerItemId(item.itemId);
    setMovementKindFilter(ALL);
    setMovementSearch("");
    setTab("movements");
  };

  const ledgerItem = React.useMemo(
    () => (ledgerItemId ? (itemList.find((item) => item.itemId === ledgerItemId) ?? null) : null),
    [itemList, ledgerItemId],
  );

  const exportStock = () => {
    const headers = [
      "SKU",
      "Name",
      "Category",
      "Warehouse",
      "Bin",
      "UoM",
      "On hand",
      "Allocated",
      "Available",
      "Reorder point",
      "Status",
      ...(access.canValueInventory ? ["Unit cost", "Stock at cost"] : []),
    ];
    const rows = sortedItems.map((item) => [
      item.sku,
      item.name,
      item.category ?? "",
      item.warehouse ?? "",
      item.binLocation ?? "",
      item.unitOfMeasure ?? "",
      item.quantityOnHand ?? 0,
      item.quantityAllocated ?? 0,
      availableQuantity(item),
      item.reorderPoint ?? 0,
      item.status,
      ...(access.canValueInventory ? [item.unitCost ?? 0, extendedCost(item)] : []),
    ]);
    downloadCsv(
      `inventory-stock-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(headers, rows),
    );
    toast.success(`Exported ${rows.length} ${rows.length === 1 ? "SKU" : "SKUs"}`);
  };

  const exportLedger = () => {
    const headers = [
      "Posted at",
      "State",
      "Type",
      "SKU",
      "Item",
      "Quantity",
      "On-hand change",
      "Allocated change",
      "Resulting on hand",
      "Reference",
      "Reason",
      "Actor role",
    ];
    const rows = filteredMovements.map((movement) => [
      movement.createdAt,
      movement.postedState,
      movementLabel(movement.kind),
      movement.sku,
      movement.itemName ?? "",
      movement.quantity,
      movement.onHandDelta,
      movement.allocatedDelta,
      movement.resultingOnHand,
      movement.reference ?? "",
      movement.reason ?? "",
      movement.actorRole ?? "",
    ]);
    downloadCsv(
      `inventory-ledger-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(headers, rows),
    );
    toast.success(`Exported ${rows.length} ${rows.length === 1 ? "movement" : "movements"}`);
  };

  const refreshAll = () => {
    void items.refresh();
    void movements.refresh();
  };

  const busy = items.refreshing || movements.refreshing;
  const createReason = access.denyReason("create");

  /* ---------------------------------------------------------------- *
   * Render
   * ---------------------------------------------------------------- */

  return (
    <div className="min-w-0">
      <PageHeader
        title={t("Inventory")}
        description={t("Warehouse stock, allocations, and the ledger behind every unit.")}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={refreshAll} disabled={busy}>
              <RefreshCw className={cn("h-4 w-4", busy && "animate-spin")} />
              {t("Refresh")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={tab === "movements" ? exportLedger : exportStock}
              disabled={items.loading}
            >
              <Download className="h-4 w-4" />
              Export {tab === "movements" ? "ledger" : "stock"}
            </Button>
            <Button
              size="sm"
              onClick={openCreateItem}
              disabled={!access.canCreateItems}
              title={createReason ?? undefined}
            >
              <PackagePlus className="h-4 w-4" />
              {t("New item")}
            </Button>
          </>
        }
      />

      <div className="min-w-0 px-4 sm:px-6 lg:px-8">
        {/* Status strip: errors and access notices before anything else, so a
            failure is never mistaken for an empty warehouse. */}
        <div className="grid gap-2 py-4">
          {items.error ? <NoticeStrip tone="danger">{items.error}</NoticeStrip> : null}
          {/* Both lists fail together for the whole class of causes that matter
              most — an unprovisioned table, a policy that omits both ARNs — and
              repeating one identical sentence twice reads as two problems. So the
              ledger banner appears only when it adds something: a *different*
              failure, phrased according to whether stock actually loaded. */}
          {movements.error && movements.error !== items.error ? (
            <NoticeStrip tone="warning">
              {items.error
                ? `The stock ledger failed separately: ${movements.error}`
                : `Stock levels loaded, but the ledger did not: ${movements.error}`}
            </NoticeStrip>
          ) : null}
          {!access.canMutateModule && !access.loading ? (
            <NoticeStrip tone="warning">
              <span className="inline-flex items-center gap-1.5">
                <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
                {t(
                  "Read-only access to Inventory. An admin can change this in Admin → Role & Access\n                → Module Permissions.",
                )}
              </span>
            </NoticeStrip>
          ) : null}
          {!access.canValueInventory && !access.loading ? (
            <NoticeStrip>
              {t(
                "Cost and valuation are withheld from your access, so those columns are hidden and the\n              server omits the values.",
              )}
            </NoticeStrip>
          ) : null}
          {unsettledCount > 0 ? (
            <NoticeStrip tone="warning">
              <span className="inline-flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {unsettledCount} {unsettledCount === 1 ? "movement" : "movements"} never settled
                against a stock level. They did not change on-hand quantities — review them in the
                ledger.
              </span>
            </NoticeStrip>
          ) : null}
        </div>

        {/* Metrics */}
        <div className="grid min-w-0 grid-cols-2 gap-3 pb-4 lg:grid-cols-3 xl:grid-cols-6">
          {items.loading ? (
            Array.from({ length: 6 }).map((_, index) => (
              <Card key={index} className="border-border/70 p-4 shadow-sm">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="mt-3 h-7 w-16" />
                <Skeleton className="mt-2 h-3 w-full" />
              </Card>
            ))
          ) : (
            <>
              <MetricCard
                label={t("Active SKUs")}
                value={summary.activeSkuCount.toLocaleString()}
                subtitle={`${summary.skuCount.toLocaleString()} total in the catalogue`}
                icon={Layers}
                tone="info"
                empty={summary.skuCount === 0}
              />
              <MetricCard
                label={t("On hand")}
                value={format.compactNumber(summary.onHandUnits)}
                subtitle={`${format.compactNumber(summary.availableUnits)} available after allocations`}
                icon={Boxes}
                tone="default"
                empty={summary.skuCount === 0}
              />
              <MetricCard
                label={t("Allocated")}
                value={format.compactNumber(summary.allocatedUnits)}
                subtitle={t("Committed to loads — physically present, not sellable")}
                icon={ShieldAlert}
                tone={summary.allocatedUnits > 0 ? "warning" : "default"}
                empty={summary.skuCount === 0}
              />
              <MetricCard
                label={t("Stock at cost")}
                value={access.canValueInventory ? format.compactCurrency(summary.costValue) : "—"}
                subtitle={
                  access.canValueInventory
                    ? `${format.compactCurrency(summary.retailValue)} at list price`
                    : "Valuation is not part of your access"
                }
                icon={CircleDollarSign}
                tone="success"
                empty={!access.canValueInventory || summary.skuCount === 0}
              />
              <MetricCard
                label={t("Below reorder")}
                value={summary.belowReorderCount.toLocaleString()}
                subtitle={`${summary.outOfStockCount} out of stock entirely`}
                icon={TrendingDown}
                tone={summary.belowReorderCount > 0 ? "danger" : "success"}
                empty={summary.skuCount === 0}
              />
              <MetricCard
                label={`Moved (${VELOCITY_WINDOW_DAYS}d)`}
                value={format.compactNumber(velocity.received + velocity.shipped)}
                subtitle={`${format.compactNumber(velocity.received)} in · ${format.compactNumber(
                  velocity.shipped,
                )} out · ${velocity.postedCount} postings`}
                icon={TrendingUp}
                tone="info"
                empty={movementList.length === 0}
              />
            </>
          )}
        </div>

        <Tabs value={tab} onValueChange={setTab} className="pb-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <TabsList>
              <TabsTrigger value="stock" className="gap-1.5">
                <Boxes className="h-3.5 w-3.5" />
                Stock
                <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-[10px]">
                  {itemList.length}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="movements" className="gap-1.5">
                <History className="h-3.5 w-3.5" />
                Ledger
                <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-[10px]">
                  {movementList.length}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="locations" className="gap-1.5">
                <Warehouse className="h-3.5 w-3.5" />
                Locations
                <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-[10px]">
                  {summary.warehouseCount}
                </Badge>
              </TabsTrigger>
            </TabsList>
          </div>

          {/* ---------------- Stock ---------------- */}
          <TabsContent value="stock" className="mt-3">
            <Card className="min-w-0 border-border/70 shadow-sm">
              <div className="flex flex-wrap items-center gap-2 border-b border-border/70 p-3">
                <div className="relative min-w-[200px] flex-1">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={filters.search}
                    onChange={(event) =>
                      setFilters((prev) => ({ ...prev, search: event.target.value }))
                    }
                    placeholder={t("Search SKU, name, supplier, bin…")}
                    className="pl-8"
                  />
                </div>

                <Select
                  value={filters.warehouse}
                  onValueChange={(value) => setFilters((prev) => ({ ...prev, warehouse: value }))}
                >
                  <SelectTrigger className="w-[160px]">
                    <SelectValue placeholder={t("Warehouse")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>{t("All warehouses")}</SelectItem>
                    {warehouses.map((warehouse) => (
                      <SelectItem key={warehouse} value={warehouse}>
                        {warehouse}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select
                  value={filters.category}
                  onValueChange={(value) => setFilters((prev) => ({ ...prev, category: value }))}
                >
                  <SelectTrigger className="w-[170px]">
                    <SelectValue placeholder={t("Category")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>{t("All categories")}</SelectItem>
                    {categories.map((category) => (
                      <SelectItem key={category} value={category}>
                        {category}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select
                  value={filters.status}
                  onValueChange={(value) => setFilters((prev) => ({ ...prev, status: value }))}
                >
                  <SelectTrigger className="w-[140px]">
                    <SelectValue placeholder={t("Status")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>{t("All statuses")}</SelectItem>
                    {INVENTORY_ITEM_STATUSES.map((status) => (
                      <SelectItem key={status} value={status}>
                        {status}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Button
                  variant={filters.lowStockOnly ? "default" : "outline"}
                  size="sm"
                  onClick={() =>
                    setFilters((prev) => ({ ...prev, lowStockOnly: !prev.lowStockOnly }))
                  }
                >
                  <TrendingDown className="h-4 w-4" />
                  Needs reorder
                  {summary.belowReorderCount > 0 ? ` (${summary.belowReorderCount})` : ""}
                </Button>

                {filtersActive ? (
                  <Button variant="ghost" size="sm" onClick={() => setFilters(EMPTY_FILTERS)}>
                    <X className="h-4 w-4" />
                    {t("Clear")}
                  </Button>
                ) : null}
              </div>

              {items.loading ? (
                <TableSkeleton rows={6} />
              ) : (
                <>
                  <InventoryStockTable
                    items={sortedItems}
                    showValuation={access.canValueInventory}
                    sortKey={sortKey}
                    sortDescending={sortDescending}
                    onSort={handleSort}
                    canEdit={access.canEditItems}
                    canDelete={access.canDeleteItems}
                    editReason={access.denyReason("edit")}
                    deleteReason={access.denyReason("delete")}
                    canPostMovement={access.canPostMovement}
                    movementReason={movementKindReason}
                    onEdit={openEditItem}
                    onDelete={setPendingDelete}
                    onMove={openMovement}
                    onInspect={inspectItem}
                    reservedLoadIds={reservedLoadIds}
                    filtered={filtersActive && itemList.length > 0}
                    emptyAction={
                      access.canCreateItems ? (
                        <Button size="sm" onClick={openCreateItem}>
                          <PackagePlus className="h-4 w-4" />
                          {t("Create the first SKU")}
                        </Button>
                      ) : undefined
                    }
                  />
                  {sortedItems.length > 0 ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 px-4 py-2.5 text-xs text-muted-foreground">
                      <span>
                        Showing {sortedItems.length} of {itemList.length}{" "}
                        {itemList.length === 1 ? "SKU" : "SKUs"}
                      </span>
                      {access.canValueInventory ? (
                        <span>
                          Filtered stock at cost:{" "}
                          <span className="font-medium text-foreground">
                            {format.currency(
                              sortedItems.reduce((sum, item) => sum + extendedCost(item), 0),
                            )}
                          </span>
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </>
              )}
            </Card>
          </TabsContent>

          {/* ---------------- Ledger ---------------- */}
          <TabsContent value="movements" className="mt-3">
            <Card className="min-w-0 border-border/70 shadow-sm">
              <div className="flex flex-wrap items-center gap-2 border-b border-border/70 p-3">
                <div className="relative min-w-[200px] flex-1">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={movementSearch}
                    onChange={(event) => setMovementSearch(event.target.value)}
                    placeholder={t("Search SKU, reference, reason…")}
                    className="pl-8"
                  />
                </div>

                <Select value={movementKindFilter} onValueChange={setMovementKindFilter}>
                  <SelectTrigger className="w-[170px]">
                    <SelectValue placeholder={t("Movement type")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>{t("All movement types")}</SelectItem>
                    {INVENTORY_MOVEMENT_KINDS.map((kind) => (
                      <SelectItem key={kind} value={kind}>
                        {movementLabel(kind)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {ledgerItem ? (
                  <Badge variant="outline" className="gap-1.5 border-primary/30 bg-primary/10">
                    {ledgerItem.sku}
                    <button
                      type="button"
                      onClick={() => setLedgerItemId(null)}
                      className="rounded-sm hover:text-foreground"
                      aria-label={t("Clear item filter")}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ) : null}
              </div>

              {movements.loading ? (
                <TableSkeleton rows={6} />
              ) : (
                <>
                  <InventoryMovementsTable
                    movements={filteredMovements}
                    filtered={
                      (movementSearch.trim() !== "" ||
                        movementKindFilter !== ALL ||
                        Boolean(ledgerItemId)) &&
                      movementList.length > 0
                    }
                  />
                  {filteredMovements.length > 0 ? (
                    <div className="border-t border-border/70 px-4 py-2.5 text-xs text-muted-foreground">
                      Showing {filteredMovements.length} of {movementList.length} ledger entries
                      {ledgerItem ? ` for ${ledgerItem.sku}` : ""}
                    </div>
                  ) : null}
                </>
              )}
            </Card>
          </TabsContent>

          {/* ---------------- Locations ---------------- */}
          <TabsContent value="locations" className="mt-3">
            <Card className="min-w-0 border-border/70 shadow-sm">
              {items.loading ? (
                <div className="grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-3">
                  {Array.from({ length: 3 }).map((_, index) => (
                    <Skeleton key={index} className="h-56 w-full rounded-xl" />
                  ))}
                </div>
              ) : (
                <InventoryLocationsPanel
                  items={itemList}
                  showValuation={access.canValueInventory}
                  activeWarehouse={filters.warehouse}
                  onSelectWarehouse={(warehouse) => {
                    setFilters((prev) => ({ ...prev, warehouse }));
                    setTab("stock");
                  }}
                />
              )}
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <InventoryItemDialog
        open={itemDialogOpen}
        onOpenChange={setItemDialogOpen}
        mode={itemDialogMode}
        form={itemForm}
        setForm={setItemForm}
        warehouses={warehouses}
        canValue={access.canValueInventory}
        valuationReason={access.denyReason("value")}
        saving={itemSaving}
        error={itemError}
        onSubmit={() => void submitItem()}
      />

      <InventoryMovementDialog
        open={movementDialogOpen}
        onOpenChange={setMovementDialogOpen}
        item={movementItem}
        form={movementForm}
        setForm={setMovementForm}
        allowedKinds={allowedKinds}
        disabledKindReason={movementKindReason}
        saving={movementSaving}
        error={movementError}
        onSubmit={() => void submitMovement()}
      />

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {pendingDelete?.sku}?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete && (pendingDelete.quantityOnHand ?? 0) > 0 ? (
                <>
                  This SKU still holds {format.number(pendingDelete.quantityOnHand)} on hand. The
                  server will refuse the delete — set its status to <strong>{t("Archived")}</strong>{" "}
                  instead, which keeps the movement history readable.
                </>
              ) : (
                <>
                  The SKU is removed from the catalogue. Its movement history stays in the ledger,
                  identified by SKU rather than by a live record.
                  {access.canValueInventory && pendingDelete
                    ? ` Last known unit cost: ${format.currencyPrecise(pendingDelete.unitCost)}.`
                    : ""}
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void confirmDelete();
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deleting…" : "Delete item"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function TableSkeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-center gap-3">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-24" />
        </div>
      ))}
    </div>
  );
}
