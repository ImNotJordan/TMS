import type { LoadRecord } from "./loads-store";

// Label maps (mirror the options shown in the Create Load wizard)
export const CUSTOMER_LABELS: Record<string, string> = {
  "acme-foods": "Acme Foods, Inc.",
  "northstar-bev": "Northstar Beverage",
  greenfield: "Greenfield Co.",
  transocean: "TransOcean Logistics",
  freshline: "Freshline Distributors",
  "summit-retail": "Summit Retail Group",
};

export const CARRIER_LABELS: Record<string, string> = {
  bluepeak: "Bluepeak Freight",
  ironline: "Ironline Logistics",
  gulfstream: "Gulfstream Express",
  sundial: "Sundial Trucking",
  northbay: "Northbay Carriers",
};

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
