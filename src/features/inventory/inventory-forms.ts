/**
 * Dialog form state for the inventory module.
 *
 * Lives apart from the dialog components so those files export only components —
 * the react-refresh rule the rest of the app follows.
 *
 * Forms hold strings rather than numbers throughout. A number input that must
 * round-trip an empty value has no numeric representation for "the user cleared
 * it", and coercing on every keystroke is what turns a half-typed "0." into 0.
 * Coercion happens once, on submit.
 */
import type {
  InventoryItemRecord,
  InventoryItemStatus,
  InventoryMovementKind,
} from "@/lib/inventory-domain";

export type ItemFormState = {
  sku: string;
  name: string;
  description: string;
  category: string;
  warehouse: string;
  binLocation: string;
  unitOfMeasure: string;
  reorderPoint: string;
  reorderQuantity: string;
  unitCost: string;
  unitPrice: string;
  supplierName: string;
  supplierSku: string;
  weightPerUnitLb: string;
  temperatureRange: string;
  hazmat: boolean;
  temperatureControlled: boolean;
  status: InventoryItemStatus;
  notes: string;
  /**
   * Create only. Posted as a separate `receipt` immediately after the item
   * lands, so the first units in the warehouse have a ledger row like every unit
   * after them — there is no "opening quantity" field on the record itself.
   */
  openingQuantity: string;
};

export function emptyItemForm(defaultWarehouse: string): ItemFormState {
  return {
    sku: "",
    name: "",
    description: "",
    category: "General Freight",
    warehouse: defaultWarehouse,
    binLocation: "",
    unitOfMeasure: "Each",
    reorderPoint: "0",
    reorderQuantity: "0",
    unitCost: "0",
    unitPrice: "0",
    supplierName: "",
    supplierSku: "",
    weightPerUnitLb: "",
    temperatureRange: "",
    hazmat: false,
    temperatureControlled: false,
    status: "Active",
    notes: "",
    openingQuantity: "",
  };
}

export function itemToForm(item: InventoryItemRecord): ItemFormState {
  return {
    sku: item.sku ?? "",
    name: item.name ?? "",
    description: item.description ?? "",
    category: item.category || "General Freight",
    warehouse: item.warehouse || "Unassigned",
    binLocation: item.binLocation ?? "",
    unitOfMeasure: item.unitOfMeasure || "Each",
    reorderPoint: String(item.reorderPoint ?? 0),
    reorderQuantity: String(item.reorderQuantity ?? 0),
    // Empty rather than "0" when the server redacted the valuation — a blank
    // field is honest about "not shown to you"; a 0 would read as free stock.
    unitCost: item.unitCost === undefined ? "" : String(item.unitCost),
    unitPrice: item.unitPrice === undefined ? "" : String(item.unitPrice),
    supplierName: item.supplierName ?? "",
    supplierSku: item.supplierSku ?? "",
    weightPerUnitLb: item.weightPerUnitLb === undefined ? "" : String(item.weightPerUnitLb),
    temperatureRange: item.temperatureRange ?? "",
    hazmat: Boolean(item.hazmat),
    temperatureControlled: Boolean(item.temperatureControlled),
    status: item.status ?? "Active",
    notes: item.notes ?? "",
    openingQuantity: "",
  };
}

export type MovementFormState = {
  kind: InventoryMovementKind;
  quantity: string;
  reason: string;
  reference: string;
  notes: string;
};

export function emptyMovementForm(kind: InventoryMovementKind = "receipt"): MovementFormState {
  return { kind, quantity: "", reason: "", reference: "", notes: "" };
}
