import type { DriverLoadRecord } from "./aws-loads";
import type { ActiveLoadStatus, Load, LoadDocument, LoadStatus } from "./mock-data";
import { STATUS_STEPS } from "./mock-data";

const ACTIVE_KEYS = new Set(STATUS_STEPS.map((s) => s.key));

const OFFER_STATUSES = new Set(["tendered", "booked", "active", "open", "available", "posted"]);

const TERMINAL_STATUSES = new Set(["delivered", "completed", "cancelled", "canceled", "draft"]);

/**
 * Ops `loadStatus` values that already describe driver progress on the road.
 * Anything not in here (`driver-assigned`, `dispatched`, `active`, `booked`, …)
 * only records what dispatch did, never what the driver did.
 */
const DRIVER_PROGRESS_BY_LOAD_STATUS: Record<string, ActiveLoadStatus> = {
  "en-route-pickup": "en-route-pickup",
  en_route_pickup: "en-route-pickup",
  "at-pickup": "at-pickup",
  at_pickup: "at-pickup",
  loaded: "loaded",
  "in-transit": "en-route-delivery",
  in_transit: "en-route-delivery",
  "en-route-delivery": "en-route-delivery",
  en_route_delivery: "en-route-delivery",
  "at-delivery": "at-delivery",
  at_delivery: "at-delivery",
};

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
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Is this load assigned to this driver?
 *
 * Exact match on the Cognito `sub`. This replaced an alias match that also
 * accepted the driver's email, their email local-part, and their display name —
 * so two drivers called "J. Smith" at different carriers matched each other's
 * loads. Identity is the sub; everything else is a label.
 */
export function isAssignedTo(value: string | undefined, driverId: string): boolean {
  const assigned = value?.trim();
  const owner = driverId?.trim();
  return Boolean(assigned && owner && assigned === owner);
}

/**
 * `driverWorkflowStatus` is shared with the ops console, which parses and writes it in
 * its own `TrackingState` vocabulary. Map those spellings onto the portal's steps so an
 * ops write-through can't strand a load on an unrecognised value.
 */
const WORKFLOW_ALIASES: Record<string, ActiveLoadStatus> = {
  accepted: "assigned",
  "driver-accepted": "assigned",
  en_route_pickup: "en-route-pickup",
  at_pickup: "at-pickup",
  "in-transit": "en-route-delivery",
  in_transit: "en-route-delivery",
  en_route_delivery: "en-route-delivery",
  at_delivery: "at-delivery",
  // The driver's view of the load ends at delivered; close-out is dispatch's job.
  "pod-uploaded": "delivered",
  completed: "delivered",
};

/** Ops-side placeholder meaning "assigned, but the driver has not acted yet". */
const WORKFLOW_UNACKNOWLEDGED = "waiting-driver";

function normalizeWorkflowStatus(raw: string): ActiveLoadStatus | null {
  if (ACTIVE_KEYS.has(raw as ActiveLoadStatus)) return raw as ActiveLoadStatus;
  return WORKFLOW_ALIASES[raw] ?? null;
}

/**
 * True once the *driver* has acted on the load, as opposed to dispatch assigning it.
 *
 * Dispatch assigning a driver writes `assignedDriver`/`loadStatus` only — it never
 * writes `driverWorkflowStatus`. Ops Tracking derives "Waiting for Driver" from that
 * missing field, so the portal must not treat a bare assignment as an acceptance:
 * doing so hides the Accept action and pins Tracking on "Waiting for Driver" forever.
 */
export function hasDriverAcknowledged(record: DriverLoadRecord): boolean {
  const workflow = (record.driverWorkflowStatus ?? "").trim().toLowerCase();
  // "waiting-driver" is ops saying the opposite — it must not count as acknowledgement.
  if (workflow && workflow !== WORKFLOW_UNACKNOWLEDGED) return true;
  if (record.driverStatusHistory?.length) return true;
  const raw = (record.loadStatus ?? "").trim().toLowerCase();
  return Boolean(DRIVER_PROGRESS_BY_LOAD_STATUS[raw]) || raw === "delivered" || raw === "completed";
}

function resolvePortalStatus(
  record: DriverLoadRecord,
  driverId: string,
  declinedIds: Set<string>,
): LoadStatus | null {
  if (declinedIds.has(record.loadId)) return "declined";

  const raw = (record.loadStatus ?? "").trim().toLowerCase();
  const workflow = (record.driverWorkflowStatus ?? "").trim().toLowerCase();
  const assigned = isAssignedTo(record.assignedDriver, driverId);

  // Declines are persisted on the record so they survive a device change.
  if (workflow === "declined") return "declined";

  const workflowStep = workflow ? normalizeWorkflowStatus(workflow) : null;
  if (workflowStep) return workflowStep;

  if (raw === "delivered" || raw === "completed") return "delivered";
  if (raw === "cancelled" || raw === "canceled" || raw === "draft") return null;

  if (assigned) {
    const progress = DRIVER_PROGRESS_BY_LOAD_STATUS[raw];
    if (progress) return progress;
    // Assigned by dispatch but the driver has not accepted yet — present it as an
    // offer so Accept writes `driverWorkflowStatus` back and Tracking advances.
    if (!hasDriverAcknowledged(record)) return "offered";
    return "assigned";
  }

  // Marketplace / tendered loads available for pickup by any signed-in driver.
  if (!record.assignedDriver?.trim()) {
    if (OFFER_STATUSES.has(raw)) return "offered";
    // Untagged but actionable freight rows (common in early Dynamo data).
    if (
      !raw &&
      (record.pickupCity ||
        record.deliveryCity ||
        record.pickupAddress ||
        record.deliveryAddress) &&
      !TERMINAL_STATUSES.has(raw)
    ) {
      return "offered";
    }
  }

  return null;
}

export function mapLoadRecordToPortalLoad(
  record: DriverLoadRecord,
  driverId: string,
  declinedIds: Set<string>,
): Load | null {
  const status = resolvePortalStatus(record, driverId, declinedIds);
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
    // Distinguishes "dispatch picked you for this load" from open marketplace freight.
    assignedByDispatch: status === "offered" && isAssignedTo(record.assignedDriver, driverId),
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
  // An assigned load is still pending until the driver accepts it.
  if (record.assignedDriver?.trim()) return !hasDriverAcknowledged(record);
  return OFFER_STATUSES.has(raw) || raw === "";
}

export function nextWorkflowStatus(current: LoadStatus): ActiveLoadStatus | null {
  const idx = STATUS_STEPS.findIndex((s) => s.key === current);
  if (idx < 0) return STATUS_STEPS[0]?.key ?? null;
  return STATUS_STEPS[idx + 1]?.key ?? null;
}
