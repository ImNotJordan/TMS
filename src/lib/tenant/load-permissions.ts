/**
 * Who may write what on a load.
 *
 * ## The hole this closes
 *
 * `handleLoadsApiRequest` resolved a tenant context and never read `ctx.role`.
 * Tenant isolation was solid — you could not touch another company's freight —
 * but *inside* a company every authenticated user had the same power as the
 * broker who priced the load. A Marketing account could `PATCH` `customerRate`
 * on any load in the tenant, at any point in its life, and because load
 * mutations write no audit row, nobody could tell afterwards that it happened.
 *
 * Three separate decisions were missing, and they are separate on purpose:
 *
 * 1. **May this role write loads at all?** Sales and Marketing need the board to
 *    do their jobs and have no business editing it. Read stays open; write does
 *    not.
 * 2. **May this role write the *economics*?** Dispatch moves trucks — changing
 *    what a customer is billed is not part of that. Accounting corrects money,
 *    but it does so on the invoice, via a credit memo with a paper trail, not by
 *    quietly rewriting the load the invoice was derived from.
 * 3. **Is the load still editable at all?** After delivery the load is evidence.
 *    See `ECONOMICALLY_FROZEN_STATUSES` in `load-status`.
 *
 * Collapsing these into one `canEditLoad(role)` was the tempting shape and it is
 * wrong: it is the version where widening one case silently widens the others.
 *
 * ## Failure direction
 *
 * An unrecognised or absent role is refused. `buildTenantContext` sets
 * `role: null` when neither the Cognito group nor `custom:role` resolves, and a
 * null role reaching a write path means authorization did not establish who is
 * asking. That is a denial, not a default.
 */
import type { Role } from "@/lib/admin-user-constants";
import { isEconomicallyFrozen, isLoadDelivered } from "@/lib/load-status";
import type { TenantContext } from "@/lib/tenant/server-tenant-context";

/**
 * What a load costs and what it pays. Editing any of these changes money.
 *
 * `paymentTerms` is here because "Net 15" vs "Net 60" is a price. `loadValue` is
 * here because it drives cargo-insurance exposure.
 */
export const LOAD_ECONOMIC_FIELDS: ReadonlySet<string> = new Set([
  "customerRate",
  "carrierRate",
  "linehaulRate",
  "fuelSurcharge",
  "accessorialCharges",
  "detentionRate",
  "lumperFee",
  "tonuFee",
  "layoverFee",
  "paymentTerms",
  "loadValue",
]);

/**
 * Fields that stop being editable once the load is delivered.
 *
 * The economics, plus the facts an invoice and a claim are argued from: what
 * moved, how much of it, where from and to, and the reference numbers a
 * shipper's AP system matches on. Changing a delivered load's BOL number three
 * weeks later is how an invoice silently stops reconciling.
 */
export const LOAD_POST_DELIVERY_FROZEN_FIELDS: ReadonlySet<string> = new Set([
  ...LOAD_ECONOMIC_FIELDS,
  "weight",
  "weightUnit",
  "dimensions",
  "palletCount",
  "pieceCount",
  "commodityDescription",
  "inventoryLines",
  "freightClass",
  "pickupReference",
  "deliveryReference",
  "pickupAddress",
  "pickupCity",
  "pickupState",
  "pickupZip",
  "deliveryAddress",
  "deliveryCity",
  "deliveryState",
  "deliveryZip",
]);

/**
 * Roles that may create or modify a load.
 *
 * Accounting is here and deliberately absent from `LOAD_PRICERS`: they need to
 * attach documents, correct a reference number before delivery and annotate a
 * billing dispute, none of which is pricing. That split is exactly why these are
 * two sets — collapsing them would have to either lock accounting out of the load
 * entirely or hand them the rates.
 */
const LOAD_WRITERS: ReadonlySet<Role> = new Set<Role>([
  "Organization Owner",
  "Admin",
  "SuperAdmin",
  "Operations Manager",
  "Broker",
  "Dispatcher",
  "Accounting",
]);

/**
 * The manually-entered tax figure.
 *
 * Economic — it lands on the invoice — but deliberately *not* in
 * `LOAD_ECONOMIC_FIELDS`, for two reasons that pull in opposite directions from
 * the rate fields:
 *
 * 1. **Who.** Rates are priced by brokers; tax is computed by whoever does the
 *    books. `LOAD_PRICERS` excludes Accounting on purpose, and Accounting is
 *    exactly who reads a VAT calculator and types the answer in. So this set has
 *    its own writer list.
 * 2. **When.** `LOAD_POST_DELIVERY_FROZEN_FIELDS` spreads
 *    `LOAD_ECONOMIC_FIELDS`, and freezing tax after delivery would break the
 *    normal workflow — tax is determined at invoicing, which happens after
 *    delivery by definition. Including it there would have locked the field
 *    exactly when it needs filling in.
 *
 * It is still audited with its values, because a changed tax figure is precisely
 * the kind of edit someone asks about later. See `load-audit`.
 */
export const LOAD_TAX_FIELDS: ReadonlySet<string> = new Set([
  "taxManualAmount",
  "taxCurrency",
  "taxManualSource",
  "taxManualNote",
  "taxLines",
]);

/**
 * Roles that may enter a tax figure.
 *
 * `LOAD_PRICERS` plus Accounting. Narrower than `LOAD_WRITERS` — a dispatcher
 * moving a truck has no business restating what the load owes — and wider than
 * `LOAD_PRICERS`, which is the whole reason this is a third set rather than a
 * reuse of either.
 */
const LOAD_TAX_SETTERS: ReadonlySet<Role> = new Set<Role>([
  "Organization Owner",
  "Admin",
  "SuperAdmin",
  "Operations Manager",
  "Broker",
  "Accounting",
]);

/**
 * Roles that may set what a load is worth.
 *
 * Deliberately excludes Dispatcher and Accounting — see the header. Narrower
 * than `LOAD_WRITERS`, and that is the whole point of two sets.
 */
const LOAD_PRICERS: ReadonlySet<Role> = new Set<Role>([
  "Organization Owner",
  "Admin",
  "SuperAdmin",
  "Operations Manager",
  "Broker",
]);

/** Deleting a load destroys the record an invoice was derived from. */
const LOAD_DELETERS: ReadonlySet<Role> = new Set<Role>([
  "Organization Owner",
  "Admin",
  "SuperAdmin",
]);

export type LoadPermissionDenial = {
  ok: false;
  status: 403;
  code:
    | "role_cannot_write_load"
    | "role_cannot_price_load"
    | "role_cannot_delete_load"
    | "role_cannot_set_load_tax";
  message: string;
  /** Named so the log and the response agree on what was attempted. */
  fields?: string[];
};

export type LoadFreezeDenial = {
  ok: false;
  status: 409;
  code: "load_economically_frozen";
  message: string;
  fields: string[];
};

export type LoadWriteCheck = { ok: true } | LoadPermissionDenial | LoadFreezeDenial;

function roleLabel(role: Role | null): string {
  return role ?? "an unassigned role";
}

/** Refuse a tax edit from a role that may not make one. */
function taxDenial(ctx: TenantContext, body: Record<string, unknown>): LoadPermissionDenial | null {
  const taxed = Object.keys(body).filter((key) => LOAD_TAX_FIELDS.has(key));
  if (taxed.length === 0) return null;
  if (ctx.role && LOAD_TAX_SETTERS.has(ctx.role)) return null;
  return {
    ok: false,
    status: 403,
    code: "role_cannot_set_load_tax",
    message: `${roleLabel(ctx.role)} cannot set the tax figure on a load: ${taxed.join(", ")}.`,
    fields: taxed,
  };
}

/** May this caller create a load? */
export function checkLoadCreate(ctx: TenantContext, body: Record<string, unknown>): LoadWriteCheck {
  if (!ctx.role || !LOAD_WRITERS.has(ctx.role)) {
    return {
      ok: false,
      status: 403,
      code: "role_cannot_write_load",
      message: `${roleLabel(ctx.role)} cannot create loads.`,
    };
  }
  const priced = Object.keys(body).filter((key) => LOAD_ECONOMIC_FIELDS.has(key));
  if (priced.length > 0 && !LOAD_PRICERS.has(ctx.role)) {
    return {
      ok: false,
      status: 403,
      code: "role_cannot_price_load",
      message: `${roleLabel(ctx.role)} cannot set load rates: ${priced.join(", ")}.`,
      fields: priced,
    };
  }
  const taxRefusal = taxDenial(ctx, body);
  if (taxRefusal) return taxRefusal;
  return { ok: true };
}

/**
 * May this caller apply this patch to this stored load?
 *
 * Takes the *stored* record, read in the same request that performs the write.
 * Passing the patch's own status would let a caller unfreeze a delivered load by
 * including `loadStatus: "draft"` alongside a rate edit.
 *
 * Takes the record rather than just `loadStatus` because delivery is recorded in
 * two places and the driver only writes one of them — see `isLoadDelivered`.
 */
export function checkLoadUpdate(
  ctx: TenantContext,
  patch: Record<string, unknown>,
  current: { loadStatus?: string | null; driverWorkflowStatus?: string | null },
): LoadWriteCheck {
  if (!ctx.role || !LOAD_WRITERS.has(ctx.role)) {
    return {
      ok: false,
      status: 403,
      code: "role_cannot_write_load",
      message: `${roleLabel(ctx.role)} cannot modify loads.`,
    };
  }

  const priced = Object.keys(patch).filter((key) => LOAD_ECONOMIC_FIELDS.has(key));
  if (priced.length > 0 && !LOAD_PRICERS.has(ctx.role)) {
    return {
      ok: false,
      status: 403,
      code: "role_cannot_price_load",
      message: `${roleLabel(ctx.role)} cannot change load rates: ${priced.join(", ")}.`,
      fields: priced,
    };
  }

  // Before the freeze check below, and deliberately not subject to it: tax is
  // entered at invoicing, which is after delivery.
  const taxRefusal = taxDenial(ctx, patch);
  if (taxRefusal) return taxRefusal;

  // Role first, then state. A Marketing account editing a delivered load's rate
  // should hear that it cannot price loads at all, not that this particular load
  // is frozen — the second answer implies the first would otherwise have passed.
  if (isLoadDelivered(current)) {
    const frozen = Object.keys(patch).filter((key) => LOAD_POST_DELIVERY_FROZEN_FIELDS.has(key));
    if (frozen.length > 0) {
      // Name whichever field establishes delivery. Quoting a stale `loadStatus`
      // here read as a contradiction — "this load is driver-assigned, so it
      // cannot be changed after delivery" — and sent the reader looking for a bug
      // instead of reaching for a credit memo.
      const evidence = isEconomicallyFrozen(current.loadStatus)
        ? `is ${current.loadStatus}`
        : `was delivered by the driver (${current.driverWorkflowStatus})`;
      return {
        ok: false,
        status: 409,
        code: "load_economically_frozen",
        message:
          `This load ${evidence} — ${frozen.join(", ")} cannot be changed after delivery. ` +
          `Correct it on the invoice with a credit memo so the original stays retrievable.`,
        fields: frozen,
      };
    }
  }

  return { ok: true };
}

/** May this caller delete a load? */
export function checkLoadDelete(ctx: TenantContext): LoadWriteCheck {
  if (!ctx.role || !LOAD_DELETERS.has(ctx.role)) {
    return {
      ok: false,
      status: 403,
      code: "role_cannot_delete_load",
      message: `${roleLabel(ctx.role)} cannot delete loads.`,
    };
  }
  return { ok: true };
}
