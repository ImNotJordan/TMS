import type { CarrierRecord, CarrierTier, PortalInviteStatus } from "./carriers-store";
import { evaluateAutoAwardEligibility } from "./carriers-store";

export type Tone = "success" | "warning" | "destructive" | "info" | "default";

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

export const TIER_LABELS: Record<CarrierTier, { label: string; tone: Tone }> = {
  none: { label: "Unranked", tone: "default" },
  preferred: { label: "Preferred", tone: "info" },
  core: { label: "Core", tone: "success" },
  strategic: { label: "Strategic", tone: "success" },
};

export const PORTAL_STATUS_LABELS: Record<PortalInviteStatus, { label: string; tone: Tone }> = {
  "not-invited": { label: "Not Invited", tone: "default" },
  invited: { label: "Invited", tone: "warning" },
  active: { label: "Active", tone: "success" },
  declined: { label: "Declined", tone: "destructive" },
};

export const EQUIPMENT_TYPE_OPTIONS = [
  "dry-van",
  "reefer",
  "flatbed",
  "step-deck",
  "lowboy",
  "tanker",
  "power-only",
  "box-truck",
] as const;

export const EQUIPMENT_TYPE_LABELS: Record<string, string> = {
  "dry-van": "Dry Van",
  reefer: "Reefer",
  flatbed: "Flatbed",
  "step-deck": "Step Deck",
  lowboy: "Lowboy / RGN",
  tanker: "Tanker",
  "power-only": "Power Only",
  "box-truck": "Box Truck",
};

export function labelOrRaw(map: Record<string, string>, value?: string) {
  if (!value) return "—";
  return map[value] ?? value;
}

export function formatDate(iso?: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function daysUntil(iso?: string, from: Date = new Date()): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
}

export type InsuranceStatus = "expired" | "expiring-soon" | "verified" | "unverified";

export function insuranceStatus(carrier: CarrierRecord, from: Date = new Date()): InsuranceStatus {
  const days = daysUntil(carrier.insuranceExpiresAt, from);
  if (days == null || days < 0) return "expired";
  if (days <= 30) return "expiring-soon";
  return carrier.insuranceVerified ? "verified" : "unverified";
}

export const INSURANCE_STATUS_LABELS: Record<InsuranceStatus, { label: string; tone: Tone }> = {
  expired: { label: "Expired", tone: "destructive" },
  "expiring-soon": { label: "Expiring Soon", tone: "warning" },
  verified: { label: "Verified", tone: "success" },
  unverified: { label: "Unverified", tone: "default" },
};

export function formatLanesServed(lanes?: string[]) {
  if (!lanes || lanes.length === 0) return "—";
  if (lanes.length <= 2) return lanes.join(", ");
  return `${lanes.slice(0, 2).join(", ")} +${lanes.length - 2}`;
}

export function formatEquipmentTypes(types?: string[]) {
  if (!types || types.length === 0) return "—";
  return types.map((t) => labelOrRaw(EQUIPMENT_TYPE_LABELS, t)).join(", ");
}

export function formatPercentage(value?: string) {
  if (!value) return "—";
  const n = parseFloat(value.replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(n)) return value;
  return `${n}%`;
}

/** Mirrors `evaluateAutoAwardEligibility` for a compact UI badge. */
export function autoAwardBadge(carrier: CarrierRecord): { label: string; tone: Tone } {
  const { eligible, reason } = evaluateAutoAwardEligibility(carrier);
  if (eligible) {
    return reason
      ? { label: "Auto-Award OK (Override)", tone: "warning" }
      : { label: "Auto-Award OK", tone: "success" };
  }
  return { label: "Auto-Award Blocked", tone: "destructive" };
}
