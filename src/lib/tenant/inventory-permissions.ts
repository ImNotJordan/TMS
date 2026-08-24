/**
 * Who may do what to inventory.
 *
 * Modelled on `load-permissions` and for the same reason: tenant isolation
 * answers "whose stock is this", and nothing else. Inside a company, an
 * inventory API that only checks the tenant hands a Marketing account the power
 * to write off a pallet.
 *
 * Four decisions, kept separate on purpose:
 *
 * 1. **May this role maintain the catalogue at all?** Sales and Marketing need
 *    to see what is in the warehouse to sell it. Creating and editing SKUs is
 *    not part of that. Read stays open; write does not.
 * 2. **May this role set what stock is worth?** `unitCost` and `unitPrice` are
 *    the basis of the inventory valuation that lands in the accounts. Dispatch
 *    moves freight; it does not revalue it.
 * 3. **May this role move stock, and which way?** Receipts, shipments and
 *    allocations are the dock's job. Adjustments and cycle counts are how
 *    shrink is recorded, so they are narrower — an adjustment is a write-off
 *    with no counterparty, and the role that can post one silently can make a
 *    discrepancy disappear.
 * 4. **May this role destroy the record?** Deleting a SKU deletes the thing its
 *    movement history refers to.
 *
 * Collapsing these into one `canEditInventory(role)` is the tempting shape and
 * it is wrong for the same reason it was wrong for loads: it is the version
 * where widening one case silently widens the rest.
 *
 * ## Failure direction
 *
 * An absent or unrecognised role is refused. `buildTenantContext` sets
 * `role: null` when neither the Cognito group nor `custom:role` resolves, and a
 * null role on a write path means authorization never established who is
 * asking. That is a denial, not a default.
 */
import type { Role } from "@/lib/admin-user-constants";
import type { InventoryItemRecord, InventoryMovementKind } from "@/lib/inventory-domain";
import type { TenantContext } from "@/lib/tenant/server-tenant-context";

/**
 * What stock is worth. Editing either changes the balance sheet.
 *
 * `unitPrice` is here alongside `unitCost` because it is the number a quote is
 * built from — moving it moves revenue, even though it never touches valuation.
 */
export const INVENTORY_ECONOMIC_FIELDS: ReadonlySet<string> = new Set(["unitCost", "unitPrice"]);

/**
 * Fields the ledger owns.
 *
 * Not "validated then written" — refused. A patch carrying `quantityOnHand` is
 * either a client sending a whole record back on save (harmless, and stripped
 * client-side before it reaches here) or an attempt to move stock without a
 * ledger row. Both get the same answer, because the endpoint cannot tell them
 * apart and only one of them is safe to honour.
 */
export const INVENTORY_LEDGER_OWNED_FIELDS: ReadonlySet<string> = new Set([
  "quantityOnHand",
  "quantityAllocated",
  "lastMovementAt",
  "lastCountedAt",
]);

/** Roles that may create and edit SKUs. */
const INVENTORY_WRITERS: ReadonlySet<Role> = new Set<Role>([
  "Organization Owner",
  "Admin",
  "SuperAdmin",
  "Operations Manager",
  "Dispatcher",
]);

/**
 * Roles that may set cost and price.
 *
 * Accounting is here and absent from `INVENTORY_WRITERS`: valuing stock is their
 * job, maintaining the catalogue is not. Dispatcher is the mirror image. That
 * asymmetry is the reason these are two sets rather than one.
 */
const INVENTORY_VALUERS: ReadonlySet<Role> = new Set<Role>([
  "Organization Owner",
  "Admin",
  "SuperAdmin",
  "Operations Manager",
  "Accounting",
]);

/** Roles that may post the operational movements — the dock's day-to-day. */
const INVENTORY_MOVERS: ReadonlySet<Role> = new Set<Role>([
  "Organization Owner",
  "Admin",
  "SuperAdmin",
  "Operations Manager",
  "Dispatcher",
]);

/**
 * Roles that may post an adjustment or a cycle count.
 *
 * Narrower than `INVENTORY_MOVERS` by one role, and that one role is the point:
 * a dispatcher who can post an adjustment can cover a shipping error by writing
 * the units off instead of reporting them short.
 */
const INVENTORY_ADJUSTERS: ReadonlySet<Role> = new Set<Role>([
  "Organization Owner",
  "Admin",
  "SuperAdmin",
  "Operations Manager",
]);

/** Deleting a SKU orphans its movement history. */
const INVENTORY_DELETERS: ReadonlySet<Role> = new Set<Role>([
  "Organization Owner",
  "Admin",
  "SuperAdmin",
]);

const ADJUSTING_KINDS: ReadonlySet<InventoryMovementKind> = new Set<InventoryMovementKind>([
  "adjustment",
  "count",
]);

export type InventoryDenialCode =
  | "role_cannot_write_inventory"
  | "role_cannot_value_inventory"
  | "role_cannot_move_stock"
  | "role_cannot_adjust_stock"
  | "role_cannot_delete_inventory"
  | "ledger_owned_field"
  | "item_not_writable"
  | "item_has_stock";

export type InventoryDenial = {
  ok: false;
  status: 403 | 409;
  code: InventoryDenialCode;
  message: string;
  /** Named so the log and the response agree on what was attempted. */
  fields?: string[];
};

export type InventoryWriteCheck = { ok: true } | InventoryDenial;

function roleLabel(role: Role | null): string {
  return role ?? "an unassigned role";
}

function ledgerOwnedDenial(body: Record<string, unknown>): InventoryDenial | null {
  const offending = Object.keys(body).filter((key) => INVENTORY_LEDGER_OWNED_FIELDS.has(key));
  if (offending.length === 0) return null;
  return {
    ok: false,
    status: 403,
    code: "ledger_owned_field",
    message:
      `${offending.join(", ")} follow the movement ledger and cannot be set directly. ` +
      `Post a movement instead.`,
    fields: offending,
  };
}

function economicDenial(
  ctx: TenantContext,
  body: Record<string, unknown>,
  verb: string,
): InventoryDenial | null {
  const priced = Object.keys(body).filter((key) => INVENTORY_ECONOMIC_FIELDS.has(key));
  if (priced.length === 0) return null;
  if (ctx.role && INVENTORY_VALUERS.has(ctx.role)) return null;
  return {
    ok: false,
    status: 403,
    code: "role_cannot_value_inventory",
    message: `${roleLabel(ctx.role)} cannot ${verb} inventory cost or price: ${priced.join(", ")}.`,
    fields: priced,
  };
}

/** May this caller create a SKU with this payload? */
export function checkInventoryItemCreate(
  ctx: TenantContext,
  body: Record<string, unknown>,
): InventoryWriteCheck {
  if (!ctx.role || !INVENTORY_WRITERS.has(ctx.role)) {
    return {
      ok: false,
      status: 403,
      code: "role_cannot_write_inventory",
      message: `${roleLabel(ctx.role)} cannot create inventory items.`,
    };
  }
  // Opening stock is a receipt, not a field on the create. Checked before the
  // economic gate so the more specific answer wins.
  const ledgerOwned = ledgerOwnedDenial(body);
  if (ledgerOwned) return ledgerOwned;

  const economic = economicDenial(ctx, body, "set");
  if (economic) return economic;

  return { ok: true };
}

/**
 * May this caller apply this patch to this stored item?
 *
 * Takes the stored record, read in the same request as the write. An archived
 * SKU is closed to edits; passing the patch's own status instead would let a
 * caller reopen it by including `status: "Active"` alongside the change.
 */
export function checkInventoryItemUpdate(
  ctx: TenantContext,
  patch: Record<string, unknown>,
  current: Pick<InventoryItemRecord, "status">,
): InventoryWriteCheck {
  if (!ctx.role || !INVENTORY_WRITERS.has(ctx.role)) {
    return {
      ok: false,
      status: 403,
      code: "role_cannot_write_inventory",
      message: `${roleLabel(ctx.role)} cannot modify inventory items.`,
    };
  }

  const ledgerOwned = ledgerOwnedDenial(patch);
  if (ledgerOwned) return ledgerOwned;

  const economic = economicDenial(ctx, patch, "change");
  if (economic) return economic;

  // Role first, then state — a Marketing account editing an archived SKU should
  // hear that it cannot edit inventory at all, not that this particular SKU is
  // closed. The second answer implies the first would otherwise have passed.
  if (current.status === "Archived") {
    const reopening = patch.status !== undefined && patch.status !== "Archived";
    if (!reopening) {
      return {
        ok: false,
        status: 409,
        code: "item_not_writable",
        message: "This SKU is archived. Set its status back to Active before editing it.",
      };
    }
  }

  return { ok: true };
}

/**
 * May this caller delete this item?
 *
 * A SKU holding stock is refused even for an owner. Deleting it would drop units
 * out of the valuation with no movement explaining where they went — the ledger
 * would still show them received and never shipped. Archiving keeps the history
 * addressable, which is why the message points there.
 */
export function checkInventoryItemDelete(
  ctx: TenantContext,
  current: Pick<InventoryItemRecord, "quantityOnHand" | "quantityAllocated">,
): InventoryWriteCheck {
  if (!ctx.role || !INVENTORY_DELETERS.has(ctx.role)) {
    return {
      ok: false,
      status: 403,
      code: "role_cannot_delete_inventory",
      message: `${roleLabel(ctx.role)} cannot delete inventory items.`,
    };
  }

  const onHand = current.quantityOnHand ?? 0;
  const allocated = current.quantityAllocated ?? 0;
  if (onHand !== 0 || allocated !== 0) {
    return {
      ok: false,
      status: 409,
      code: "item_has_stock",
      message:
        `This SKU still holds ${onHand.toLocaleString()} on hand and ` +
        `${allocated.toLocaleString()} allocated. Move the stock out, or set its status to ` +
        `Archived so the movement history stays readable.`,
    };
  }

  return { ok: true };
}

/** May this caller post this kind of movement? */
export function checkInventoryMovement(
  ctx: TenantContext,
  kind: InventoryMovementKind,
): InventoryWriteCheck {
  const adjusting = ADJUSTING_KINDS.has(kind);
  const allowed = adjusting ? INVENTORY_ADJUSTERS : INVENTORY_MOVERS;

  if (!ctx.role || !allowed.has(ctx.role)) {
    return {
      ok: false,
      status: 403,
      code: adjusting ? "role_cannot_adjust_stock" : "role_cannot_move_stock",
      message: adjusting
        ? `${roleLabel(ctx.role)} cannot post inventory adjustments or cycle counts.`
        : `${roleLabel(ctx.role)} cannot post inventory movements.`,
    };
  }

  return { ok: true };
}

/**
 * Client-side mirrors.
 *
 * The page uses these to disable a control the server would refuse, so the user
 * sees why up front instead of after a round trip. They are not the boundary —
 * the checks above are, and they run on a role taken from the verified token.
 */
export function roleCanWriteInventory(role: Role | null | undefined): boolean {
  return Boolean(role && INVENTORY_WRITERS.has(role));
}

export function roleCanValueInventory(role: Role | null | undefined): boolean {
  return Boolean(role && INVENTORY_VALUERS.has(role));
}

export function roleCanMoveStock(
  role: Role | null | undefined,
  kind?: InventoryMovementKind,
): boolean {
  if (!role) return false;
  if (kind && ADJUSTING_KINDS.has(kind)) return INVENTORY_ADJUSTERS.has(role);
  return INVENTORY_MOVERS.has(role);
}

export function roleCanDeleteInventory(role: Role | null | undefined): boolean {
  return Boolean(role && INVENTORY_DELETERS.has(role));
}
