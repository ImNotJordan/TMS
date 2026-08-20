import type { DriverLoadRecord } from "./aws-loads";
import type { ActiveLoadStatus, Load, LoadDocument, LoadStatus } from "./mock-data";
import { STATUS_STEPS } from "./mock-data";

const ACTIVE_KEYS = new Set(STATUS_STEPS.map((s) => s.key));

const OFFER_STATUSES = new Set([
  "tendered",
  "booked",
  "active",
  "open",
  "available",
  "posted",
]);

const TERMINAL_STATUSES = new Set(["delivered", "completed", "cancelled", "canceled", "draft"]);

function parseMoney(value?: string): number {
  if (!value) return 0;
  const n = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function parseWeightLbs(record: DriverLoadRecord): number {
  const n = Number(String(record.weight ?? "").replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (record.weightUnit === "kg") return Math.round(n * 2.20462);
  return Math.round(n);
}

function formatWindow(date?: string, start?: string, end?: string, appointment?: string): string {
  const day = date?.trim() || "";
  if (appointment?.trim()) return day ? `${day}, ${appointment.trim()}` : appointment.trim();
  if (start && end) return day ? `${day}, ${start} – ${end}` : `${start} – ${end}`;
  if (start) return day ? `${day}, ${start}` : start;
  return day || "TBD";
}

function formatAddress(parts: {
  facility?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
}): string {
  if (parts.address?.trim()) return parts.address.trim();
  const cityState = [parts.city, parts.state].filter(Boolean).join(", ");
  const line = [parts.facility, cityState, parts.zip].filter(Boolean).join(" · ");
  return line || "Address TBD";
}

function mapDocuments(record: DriverLoadRecord): LoadDocument[] {
  const assets = record.documentAssets ?? [];
  const bolAsset = assets.find((a) => a.kind === "bol");
  const podAsset = assets.find((a) => a.kind === "pod");
  const names = record.documents ?? [];
  const bolTag = names.find((d) => /^bol:/i.test(d) || /bol|bill/i.test(d));
  const podTag = names.find((d) => /^pod:/i.test(d) || /pod|proof|delivery/i.test(d));

  return [
    {
      type: "Bill of Lading",
      fileName: bolAsset?.fileName ?? (bolTag?.includes(":") ? bolTag.slice(4) : bolTag),
      uploadedAt: bolAsset ? formatUploadedAt(bolAsset.uploadedAt) : bolTag ? "On file" : undefined,
      contentType: bolAsset?.contentType,
      viewUrl: bolAsset?.dataUrl,
      size: bolAsset?.size,
      assetId: bolAsset?.id,
    },
    {
      type: "Proof of Delivery",
      fileName: podAsset?.fileName ?? (podTag?.includes(":") ? podTag.slice(4) : podTag),
      uploadedAt: podAsset ? formatUploadedAt(podAsset.uploadedAt) : podTag ? "On file" : undefined,
      contentType: podAsset?.contentType,
      viewUrl: podAsset?.dataUrl,
      size: podAsset?.size,
      assetId: podAsset?.id,
    },
  ];
}

function formatUploadedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "On file";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function aliasesMatchDriver(value: string | undefined, aliases: string[]): boolean {
  if (!value?.trim() || aliases.length === 0) return false;
  const needle = value.trim().toLowerCase();
  return aliases.some((a) => a.toLowerCase() === needle);
}

export function buildDriverAliases(input: {
  userId: string;
  email?: string;
  name?: string;
  attributes?: Record<string, string | undefined>;
}): string[] {
  const set = new Set<string>();
  const add = (v?: string) => {
    const t = v?.trim();
    if (t) set.add(t);
  };
  add(input.userId);
  add(input.email);
  add(input.email?.split("@")[0]);
  add(input.name);
  add(input.attributes?.["custom:driverId"]);
  add(input.attributes?.["custom:driver_id"]);
  add(input.attributes?.preferred_username);
  return [...set];
}

function resolvePortalStatus(
  record: DriverLoadRecord,
  aliases: string[],
  declinedIds: Set<string>,
): LoadStatus | null {
  if (declinedIds.has(record.loadId)) return "declined";

  const raw = (record.loadStatus ?? "").trim().toLowerCase();
  const workflow = (record.driverWorkflowStatus ?? "").trim().toLowerCase();
  const assigned = aliasesMatchDriver(record.assignedDriver, aliases);

  if (workflow && ACTIVE_KEYS.has(workflow as ActiveLoadStatus)) {
    return workflow as ActiveLoadStatus;
  }

  if (raw === "delivered" || raw === "completed") return "delivered";
  if (raw === "cancelled" || raw === "canceled" || raw === "draft") return null;

  if (assigned) {
    if (raw === "in-transit" || raw === "in_transit") return "en-route-delivery";
    if (raw === "en-route-pickup" || raw === "en_route_pickup") return "en-route-pickup";
    if (raw === "at-pickup" || raw === "at_pickup") return "at-pickup";
    if (raw === "at-delivery" || raw === "at_delivery") return "at-delivery";
    if (raw === "driver-assigned" || raw === "dispatched" || raw === "active") return "assigned";
    return "assigned";
  }

  // Marketplace / tendered loads available for pickup by any signed-in driver.
  if (!record.assignedDriver?.trim()) {
    if (OFFER_STATUSES.has(raw)) return "offered";
    // Untagged but actionable freight rows (common in early Dynamo data).
    if (
      !raw &&
      (record.pickupCity || record.deliveryCity || record.pickupAddress || record.deliveryAddress) &&
      !TERMINAL_STATUSES.has(raw)
    ) {
      return "offered";
    }
  }

  return null;
}

export function mapLoadRecordToPortalLoad(
  record: DriverLoadRecord,
  aliases: string[],
  declinedIds: Set<string>,
): Load | null {
  const status = resolvePortalStatus(record, aliases, declinedIds);
  if (!status) return null;

  const rate =
    parseMoney(record.carrierRate) ||
    parseMoney(record.linehaulRate) ||
    parseMoney(record.customerRate);

  const equipment =
    [record.equipmentType, record.trailerType].filter(Boolean).join(" · ") || "Equipment TBD";

  return {
    id: record.loadId,
    status,
    equipment,
    distanceMiles: 0,
    rate,
    weightLbs: parseWeightLbs(record),
    pickup: {
      city: record.pickupCity?.trim() || "Pickup",
      state: record.pickupState?.trim() || "",
      address: formatAddress({
        facility: record.pickupFacility,
        address: record.pickupAddress,
        city: record.pickupCity,
        state: record.pickupState,
        zip: record.pickupZip,
      }),
      window: formatWindow(
        record.pickupDate,
        record.pickupWindowStart,
        record.pickupWindowEnd,
        record.pickupAppointmentTime,
      ),
    },
    delivery: {
      city: record.deliveryCity?.trim() || "Delivery",
      state: record.deliveryState?.trim() || "",
      address: formatAddress({
        facility: record.deliveryFacility,
        address: record.deliveryAddress,
        city: record.deliveryCity,
        state: record.deliveryState,
        zip: record.deliveryZip,
      }),
      window: formatWindow(
        record.deliveryDate,
        record.deliveryWindowStart,
        record.deliveryWindowEnd,
        record.deliveryAppointmentTime,
      ),
    },
    brokerName: record.broker?.trim() || record.customer?.trim() || "Dispatch",
    notes: record.internalNotes?.trim() || record.pickupInstructions?.trim() || undefined,
    documents: mapDocuments(record),
  };
}

export function isOfferEligibleRecord(record: DriverLoadRecord): boolean {
  const raw = (record.loadStatus ?? "").trim().toLowerCase();
  if (TERMINAL_STATUSES.has(raw)) return false;
  if (record.assignedDriver?.trim()) return false;
  return OFFER_STATUSES.has(raw) || raw === "";
}

export function nextWorkflowStatus(current: LoadStatus): ActiveLoadStatus | null {
  const idx = STATUS_STEPS.findIndex((s) => s.key === current);
  if (idx < 0) return STATUS_STEPS[0]?.key ?? null;
  return STATUS_STEPS[idx + 1]?.key ?? null;
}
