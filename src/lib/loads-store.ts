import { apiCreateLoad, apiDeleteLoad, apiGetLoad, apiListLoads, apiUpdateLoad } from "./loads-api";
import {
  fetchOperationalListCached,
  getOperationalCacheScope,
  readOperationalItemFromListCache,
  removeOperationalListItem,
  upsertOperationalListItem,
  type OperationalListKind,
} from "./operational-data-cache";

/** Soft guard under DynamoDB 400KB item limit for data-URL document blobs. */
export const LOAD_DOCUMENT_DATA_URL_SOFT_LIMIT = 350_000;

export type LoadRecord = {
  loadId: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  loadType?: string;
  loadStatus?: string;
  customer?: string;
  broker?: string;
  dispatcher?: string;
  equipmentType?: string;
  trailerType?: string;
  loadPriority?: string;
  internalNotes?: string;
  pickupFacility?: string;
  pickupAddress?: string;
  pickupCity?: string;
  pickupState?: string;
  pickupZip?: string;
  pickupContactName?: string;
  pickupContactPhone?: string;
  pickupContactEmail?: string;
  pickupDate?: string;
  pickupAppointmentTime?: string;
  pickupWindowStart?: string;
  pickupWindowEnd?: string;
  pickupInstructions?: string;
  pickupReference?: string;
  deliveryFacility?: string;
  deliveryAddress?: string;
  deliveryCity?: string;
  deliveryState?: string;
  deliveryZip?: string;
  deliveryContactName?: string;
  deliveryContactPhone?: string;
  deliveryContactEmail?: string;
  deliveryDate?: string;
  deliveryAppointmentTime?: string;
  deliveryWindowStart?: string;
  deliveryWindowEnd?: string;
  deliveryInstructions?: string;
  deliveryReference?: string;
  commodityDescription?: string;
  freightClass?: string;
  weight?: string;
  weightUnit?: "lbs" | "kg";
  dimensions?: string;
  palletCount?: string;
  pieceCount?: string;
  packagingType?: string;
  temperatureRequirement?: string;
  hazmat?: boolean;
  hazmatUn?: string;
  specialHandling?: string[];
  sealNumber?: string;
  loadValue?: string;
  customerRate?: string;
  carrierRate?: string;
  linehaulRate?: string;
  fuelSurcharge?: string;
  accessorialCharges?: string;
  detentionRate?: string;
  lumperFee?: string;
  tonuFee?: string;
  layoverFee?: string;
  paymentTerms?: string;
  assignedCarrier?: string;
  assignedDriver?: string;
  driverWorkflowStatus?: string;
  driverStatusHistory?: DriverStatusHistoryEntry[];
  trackingRequired?: boolean;
  trackingMethod?: string;
  checkInRequired?: boolean;
  checkOutRequired?: boolean;
  documents?: string[];
  documentAssets?: import("./load-documents").LoadDocumentAsset[];
  driverGps?: import("./driver-gps").DriverGpsPing;
  trackingSession?: import("./tracking-workflow-store").TrackingSessionCloud;
  insuranceVerified?: boolean;
  authorityVerified?: boolean;
  highValueFlag?: boolean;
};

export type DriverStatusHistoryEntry = {
  status: string;
  at: string;
  by?: string;
  byName?: string;
};

export type CreateLoadInput = Omit<LoadRecord, "createdAt" | "updatedAt">;

export function warnIfLoadDocumentsOversized(
  record: Pick<LoadRecord, "loadId" | "documentAssets">,
) {
  const assets = record.documentAssets;
  if (!assets?.length) return;
  let total = 0;
  for (const asset of assets) {
    total += asset.dataUrl?.length ?? 0;
  }
  if (total > LOAD_DOCUMENT_DATA_URL_SOFT_LIMIT) {
    console.warn("[Loads] document data-URL payload near Dynamo item limit", {
      loadId: record.loadId,
      chars: total,
      softLimit: LOAD_DOCUMENT_DATA_URL_SOFT_LIMIT,
    });
  }
}

/**
 * ## Transport
 *
 * These go through `/api/loads`, not DynamoDB. The server derives the tenant
 * from the verified token and scopes every query; the browser holds no
 * credentials for the Loads table and needs none.
 *
 * The exported names and signatures are unchanged from the direct-Dynamo
 * version on purpose — every screen that calls `listAllLoadsCached` or
 * `updateLoad` keeps working untouched. Swapping the transport under a stable
 * surface is what makes the remaining stores a repeatable exercise rather than
 * a rewrite.
 *
 * The list cache stays: it dedupes and smooths polling. It is a UX cache in
 * front of an already-scoped fetch, not a substitute for scoping.
 */

/** Cross-request de-dupe + session cache, unchanged from before. */
const LOADS_CACHE_KIND: OperationalListKind = "loads";
const getLoadId = (row: LoadRecord) => row.loadId;

export async function listAllLoads(): Promise<LoadRecord[]> {
  return apiListLoads();
}

export async function listAllLoadsCached(options?: {
  force?: boolean;
  scope?: string;
}): Promise<LoadRecord[]> {
  return fetchOperationalListCached({
    kind: LOADS_CACHE_KIND,
    scope: options?.scope,
    force: options?.force,
    getId: getLoadId,
    fetchRemote: apiListLoads,
  });
}

export async function getLoadById(loadId: string): Promise<LoadRecord | null> {
  return apiGetLoad(loadId);
}

export async function getLoadByIdCached(
  loadId: string,
  options?: { force?: boolean; scope?: string },
): Promise<LoadRecord | null> {
  const id = loadId?.trim();
  if (!id) return null;
  const scope = options?.scope ?? getOperationalCacheScope();

  if (!options?.force) {
    const cached = readOperationalItemFromListCache<LoadRecord>(
      LOADS_CACHE_KIND,
      scope,
      id,
      getLoadId,
    );
    if (cached) return cached;
  }

  const remote = await apiGetLoad(id);
  if (remote) upsertOperationalListItem(LOADS_CACHE_KIND, scope, remote, getLoadId);
  return remote;
}

export async function createLoad(
  input: Omit<LoadRecord, "createdAt" | "updatedAt">,
): Promise<LoadRecord> {
  warnIfLoadDocumentsOversized(input as LoadRecord);
  const created = await apiCreateLoad(input);
  upsertOperationalListItem(LOADS_CACHE_KIND, getOperationalCacheScope(), created, getLoadId);
  return created;
}

/**
 * Whole-record save from an editor screen.
 *
 * Sent as a patch: the server owns `companyId`, `createdBy` and the timestamps,
 * and the transport strips them rather than letting a stale copy overwrite them.
 */
export async function updateLoad(record: LoadRecord): Promise<LoadRecord> {
  warnIfLoadDocumentsOversized(record);
  const updated = await apiUpdateLoad(record.loadId, record);
  upsertOperationalListItem(LOADS_CACHE_KIND, getOperationalCacheScope(), updated, getLoadId);
  return updated;
}

/** Partial write — use when touching attributes the driver portal does not own. */
export async function patchLoad(loadId: string, attributes: Partial<LoadRecord>): Promise<void> {
  const updated = await apiUpdateLoad(loadId, attributes);
  upsertOperationalListItem(LOADS_CACHE_KIND, getOperationalCacheScope(), updated, getLoadId);
}

export async function deleteLoad(loadId: string): Promise<void> {
  await apiDeleteLoad(loadId);
  removeOperationalListItem(
    LOADS_CACHE_KIND,
    getOperationalCacheScope(),
    loadId,
    getLoadId as unknown as (row: { updatedAt: string }) => string,
  );
}

/**
 * Loads created by one user.
 *
 * Filtered from the company's list rather than queried on `createdBy-index`.
 * The list is already tenant-scoped by the server, so this narrows within a
 * result set the caller is entitled to — there is no second boundary to get
 * wrong. If the per-user view ever outgrows that, it becomes a server-side
 * filter, not a client-side index query.
 */
export async function listLoadsByUser(userId: string): Promise<LoadRecord[]> {
  const owner = userId?.trim();
  if (!owner) return [];
  const all = await listAllLoadsCached();
  return all.filter((load) => load.createdBy === owner);
}
