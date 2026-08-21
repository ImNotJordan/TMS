import * as React from "react";
import { Loader2, PackagePlus, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  INVENTORY_CATEGORIES,
  INVENTORY_ITEM_STATUSES,
  INVENTORY_UNITS_OF_MEASURE,
  type InventoryItemStatus,
} from "@/lib/inventory-domain";
import type { ItemFormState } from "@/features/inventory/inventory-forms";
import { NoticeStrip } from "@/features/inventory/inventory-ui";
import { t } from "@/lib/i18n/t";

function Field({
  label,
  hint,
  htmlFor,
  children,
  className,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
        {label}
      </Label>
      <div className="mt-1.5">{children}</div>
      {hint ? <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </p>
  );
}

export function InventoryItemDialog({
  open,
  onOpenChange,
  mode,
  form,
  setForm,
  warehouses,
  canValue,
  valuationReason,
  saving,
  error,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  form: ItemFormState;
  setForm: React.Dispatch<React.SetStateAction<ItemFormState>>;
  warehouses: string[];
  canValue: boolean;
  valuationReason: string | null;
  saving: boolean;
  error: string | null;
  onSubmit: () => void;
}) {
  const set = <K extends keyof ItemFormState>(key: K, value: ItemFormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const skuMissing = !form.sku.trim();
  const nameMissing = !form.name.trim();
  const blocked = saving || skuMissing || nameMissing;

  const warehouseOptions = React.useMemo(() => {
    const set_ = new Set(warehouses.filter(Boolean));
    if (form.warehouse) set_.add(form.warehouse);
    set_.add("Unassigned");
    return [...set_].sort((a, b) => a.localeCompare(b));
  }, [form.warehouse, warehouses]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {mode === "create" ? (
              <PackagePlus className="h-4 w-4 text-primary" />
            ) : (
              <Save className="h-4 w-4 text-primary" />
            )}
            {mode === "create" ? "New inventory item" : `Edit ${form.sku || "item"}`}
          </DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Create the SKU, then set its opening stock — recorded as a receipt so the ledger balances from day one."
              : "Stock levels are not editable here. Use Record movement so every change carries a reason and an actor."}
          </DialogDescription>
        </DialogHeader>

        {error ? <NoticeStrip tone="danger">{error}</NoticeStrip> : null}

        <div className="space-y-5">
          <div className="space-y-3">
            <SectionLabel>{t("Identification")}</SectionLabel>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("SKU *")} htmlFor="inv-sku">
                <Input
                  id="inv-sku"
                  value={form.sku}
                  onChange={(event) => set("sku", event.target.value)}
                  placeholder="TFD-PLT-0001"
                  aria-invalid={skuMissing}
                />
              </Field>
              <Field label={t("Item name *")} htmlFor="inv-name">
                <Input
                  id="inv-name"
                  value={form.name}
                  onChange={(event) => set("name", event.target.value)}
                  placeholder={t("48x40 Grade A pallet")}
                  aria-invalid={nameMissing}
                />
              </Field>
            </div>
            <Field label={t("Description")} htmlFor="inv-description">
              <Textarea
                id="inv-description"
                value={form.description}
                onChange={(event) => set("description", event.target.value)}
                placeholder={t("Anything the dock needs to know when handling this item.")}
                rows={2}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={t("Category")}>
                <Select value={form.category} onValueChange={(value) => set("category", value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INVENTORY_CATEGORIES.map((category) => (
                      <SelectItem key={category} value={category}>
                        {category}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t("Unit of measure")}>
                <Select
                  value={form.unitOfMeasure}
                  onValueChange={(value) => set("unitOfMeasure", value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INVENTORY_UNITS_OF_MEASURE.map((unit) => (
                      <SelectItem key={unit} value={unit}>
                        {unit}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t("Status")}>
                <Select
                  value={form.status}
                  onValueChange={(value) => set("status", value as InventoryItemStatus)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INVENTORY_ITEM_STATUSES.map((status) => (
                      <SelectItem key={status} value={status}>
                        {status}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </div>

          <Separator />

          <div className="space-y-3">
            <SectionLabel>{t("Location")}</SectionLabel>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={t("Warehouse")} hint={t("Locations come from the SKUs that use them.")}>
                <Select value={form.warehouse} onValueChange={(value) => set("warehouse", value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {warehouseOptions.map((warehouse) => (
                      <SelectItem key={warehouse} value={warehouse}>
                        {warehouse}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field
                label={t("New warehouse")}
                htmlFor="inv-new-warehouse"
                hint={t("Overrides the list.")}
              >
                <Input
                  id="inv-new-warehouse"
                  value={warehouseOptions.includes(form.warehouse) ? "" : form.warehouse}
                  onChange={(event) => set("warehouse", event.target.value || "Unassigned")}
                  placeholder={t("Dallas DC")}
                />
              </Field>
              <Field label={t("Bin / rack")} htmlFor="inv-bin">
                <Input
                  id="inv-bin"
                  value={form.binLocation}
                  onChange={(event) => set("binLocation", event.target.value)}
                  placeholder="A-12-3"
                />
              </Field>
            </div>
          </div>

          <Separator />

          <div className="space-y-3">
            <SectionLabel>{t("Replenishment")}</SectionLabel>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field
                label={t("Reorder point")}
                htmlFor="inv-reorder-point"
                hint={t("Available stock at or below this is flagged low.")}
              >
                <Input
                  id="inv-reorder-point"
                  type="number"
                  min={0}
                  step="any"
                  value={form.reorderPoint}
                  onChange={(event) => set("reorderPoint", event.target.value)}
                />
              </Field>
              <Field label={t("Reorder quantity")} htmlFor="inv-reorder-qty">
                <Input
                  id="inv-reorder-qty"
                  type="number"
                  min={0}
                  step="any"
                  value={form.reorderQuantity}
                  onChange={(event) => set("reorderQuantity", event.target.value)}
                />
              </Field>
              {mode === "create" ? (
                <Field
                  label={t("Opening stock")}
                  htmlFor="inv-opening"
                  hint={t("Posted as a receipt after the SKU is created.")}
                >
                  <Input
                    id="inv-opening"
                    type="number"
                    min={0}
                    step="any"
                    value={form.openingQuantity}
                    onChange={(event) => set("openingQuantity", event.target.value)}
                    placeholder="0"
                  />
                </Field>
              ) : (
                <Field label={t("Weight per unit (lb)")} htmlFor="inv-weight">
                  <Input
                    id="inv-weight"
                    type="number"
                    min={0}
                    step="any"
                    value={form.weightPerUnitLb}
                    onChange={(event) => set("weightPerUnitLb", event.target.value)}
                  />
                </Field>
              )}
            </div>
          </div>

          <Separator />

          <div className="space-y-3">
            <SectionLabel>{t("Valuation")}</SectionLabel>
            {canValue ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t("Unit cost")} htmlFor="inv-cost">
                  <Input
                    id="inv-cost"
                    type="number"
                    min={0}
                    step="0.01"
                    value={form.unitCost}
                    onChange={(event) => set("unitCost", event.target.value)}
                  />
                </Field>
                <Field label={t("Unit price")} htmlFor="inv-price">
                  <Input
                    id="inv-price"
                    type="number"
                    min={0}
                    step="0.01"
                    value={form.unitPrice}
                    onChange={(event) => set("unitPrice", event.target.value)}
                  />
                </Field>
              </div>
            ) : (
              <NoticeStrip>
                {valuationReason ??
                  "Cost and price are not part of your access. Everything else on this SKU is editable."}
              </NoticeStrip>
            )}
          </div>

          <Separator />

          <div className="space-y-3">
            <SectionLabel>{t("Handling & supply")}</SectionLabel>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("Supplier")} htmlFor="inv-supplier">
                <Input
                  id="inv-supplier"
                  value={form.supplierName}
                  onChange={(event) => set("supplierName", event.target.value)}
                  placeholder={t("Midwest Packaging Co.")}
                />
              </Field>
              <Field label={t("Supplier SKU")} htmlFor="inv-supplier-sku">
                <Input
                  id="inv-supplier-sku"
                  value={form.supplierSku}
                  onChange={(event) => set("supplierSku", event.target.value)}
                />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex items-center gap-2 rounded-md border border-border/70 px-3 py-2.5 text-sm">
                <Checkbox
                  checked={form.hazmat}
                  onCheckedChange={(checked) => set("hazmat", Boolean(checked))}
                />
                <span>{t("Hazmat — placards and paperwork required")}</span>
              </label>
              <label className="flex items-center gap-2 rounded-md border border-border/70 px-3 py-2.5 text-sm">
                <Checkbox
                  checked={form.temperatureControlled}
                  onCheckedChange={(checked) => set("temperatureControlled", Boolean(checked))}
                />
                <span>{t("Temperature controlled")}</span>
              </label>
            </div>
            {form.temperatureControlled ? (
              <Field label={t("Temperature range")} htmlFor="inv-temp">
                <Input
                  id="inv-temp"
                  value={form.temperatureRange}
                  onChange={(event) => set("temperatureRange", event.target.value)}
                  placeholder={t("34°F – 40°F")}
                />
              </Field>
            ) : null}
            {mode === "create" ? (
              <Field label={t("Weight per unit (lb)")} htmlFor="inv-weight-create">
                <Input
                  id="inv-weight-create"
                  type="number"
                  min={0}
                  step="any"
                  value={form.weightPerUnitLb}
                  onChange={(event) => set("weightPerUnitLb", event.target.value)}
                />
              </Field>
            ) : null}
            <Field label={t("Internal notes")} htmlFor="inv-notes">
              <Textarea
                id="inv-notes"
                value={form.notes}
                onChange={(event) => set("notes", event.target.value)}
                rows={2}
              />
            </Field>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t("Cancel")}
          </Button>
          <Button onClick={onSubmit} disabled={blocked}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {mode === "create" ? "Create item" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
