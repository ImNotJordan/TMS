import type { LoadRecord } from "./loads-store";

/** Base maps stay empty — CRM accounts / Carriers directory fill labels at runtime. */
export const CUSTOMER_LABELS: Record<string, string> = {};

export const CARRIER_LABELS: Record<string, string> = {};

export const EQUIPMENT_LABELS: Record<string, string> = {
  "dry-van": "Dry Van",
  reefer: "Reefer",
  flatbed: "Flatbed",
  "step-deck": "Step Deck",
  lowboy: "Lowboy / RGN",
  tanker: "Tanker",
  "power-only": "Power Only",
};

export type Tone = "success" | "warning" | "destructive" | "info" | "default";

export const STATUS_LABELS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "default" },
  active: { label: "Active", tone: "info" },
  "driver-assigned": { label: "Driver Assigned", tone: "warning" },
  "driver-accepted": { label: "Driver Accepted", tone: "info" },
  "en-route-pickup": { label: "En Route to Pickup", tone: "info" },
  "at-pickup": { label: "At Pickup", tone: "warning" },
  tendered: { label: "Tendered", tone: "info" },
  booked: { label: "Booked", tone: "info" },
  dispatched: { label: "Dispatched", tone: "info" },
  "in-transit": { label: "In Transit", tone: "warning" },
  "at-delivery": { label: "At Delivery", tone: "warning" },
  "pod-uploaded": { label: "POD Uploaded", tone: "success" },
  completed: { label: "Completed", tone: "success" },
  exception: { label: "Exception", tone: "destructive" },
  delivered: { label: "Delivered", tone: "success" },
};

export const toneBadge: Record<Tone, string> = {
  success: "bg-success/15 text-success border-success/20",
  warning: "bg-warning/20 text-warning-foreground border-warning/30",
  destructive: "bg-destructive/12 text-destructive border-destructive/20",
  info: "bg-info/15 text-info border-info/20",
  default: "bg-muted text-foreground border-border",
};

export const toneStat: Record<Tone, string> = {
  success: "bg-success/15 text-success",
  warning: "bg-warning/20 text-warning-foreground",
  destructive: "bg-destructive/12 text-destructive",
  info: "bg-info/15 text-info",
  default: "bg-muted text-foreground",
};

export function labelOrRaw(map: Record<string, string>, value?: string) {
  if (!value) return "—";
  return map[value] ?? value;
}

/** Merge static + CRM account names for load customer cells. */
export function buildCustomerLabelMap(
  accounts: Array<{ accountId: string; name?: string }>,
): Record<string, string> {
  const map: Record<string, string> = { ...CUSTOMER_LABELS };
  for (const account of accounts) {
    const id = account.accountId?.trim();
    const name = account.name?.trim();
    if (id && name) map[id] = name;
  }
  return map;
}

/** Merge static + Carriers directory names for load carrier cells. */
export function buildCarrierLabelMap(
  carriers: Array<{ carrierId: string; companyName?: string }>,
): Record<string, string> {
  const map: Record<string, string> = { ...CARRIER_LABELS };
  for (const carrier of carriers) {
    const id = carrier.carrierId?.trim();
    const name = carrier.companyName?.trim();
    if (id && name) map[id] = name;
  }
  return map;
}

export function formatPlace(city?: string, state?: string) {
  if (city && state) return `${city}, ${state}`;
  return city || state || "?";
}

export function formatLane(load: LoadRecord) {
  return `${formatPlace(load.pickupCity, load.pickupState)} → ${formatPlace(
    load.deliveryCity,
    load.deliveryState,
  )}`;
}

export function formatStop(date?: string, appt?: string, winStart?: string, winEnd?: string) {
  if (!date) return "—";
  const time = appt || (winStart && winEnd ? `${winStart}–${winEnd}` : "");
  const d = new Date(date);
  const datePart = Number.isNaN(d.getTime())
    ? date
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return time ? `${datePart} · ${time}` : datePart;
}

export function formatRate(rate?: string) {
  if (!rate) return "—";
  const n = parseFloat(rate.replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(n)) return rate;
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

/** Loads that are neither draft nor delivered — matches Loads page "Active" stat. */
export function isActiveLoad(load: LoadRecord): boolean {
  return Boolean(load.loadStatus && !["delivered", "draft"].includes(load.loadStatus));
}

function deliverySortMs(load: LoadRecord): number | null {
  if (!load.deliveryDate) return null;
  const t = new Date(load.deliveryDate).getTime();
  return Number.isFinite(t) ? t : null;
}

/** Soonest delivery first; loads without a delivery date sort after, by newest created. */
export function sortLoadsByUrgency(a: LoadRecord, b: LoadRecord): number {
  const da = deliverySortMs(a);
  const db = deliverySortMs(b);
  if (da != null && db != null && da !== db) return da - db;
  if (da != null && db == null) return -1;
  if (da == null && db != null) return 1;
  return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
}
