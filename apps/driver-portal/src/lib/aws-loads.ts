/**
 * Driver load access.
 *
 * Every call here goes to `/api/driver/loads`. The portal holds no DynamoDB
 * credentials for the Loads table and needs none: the server derives the driver
 * from the verified token and scopes every read and write to
 * `assignedDriver = <their sub>`.
 *
 * What used to be here — a full-table `Scan` filtered in the browser, plus a
 * patch that could write any attribute on any load — is now the server's job,
 * where a determined caller cannot edit it out.
 *
 * The exported names and signatures are unchanged so no screen had to move.
 */
import { apiGetDriverLoad, apiListDriverLoads, apiPatchDriverLoad } from "./loads-api";
import type { LoadDocumentAsset } from "./load-documents";

export type { LoadDocumentAsset };

/** Soft warn when document data-URLs approach Dynamo item size limits (mirrors ops loads-store). */
const LOAD_DOCUMENT_DATA_URL_SOFT_LIMIT = 350_000;

export function warnIfLoadDocumentsOversized(
  record: Pick<DriverLoadRecord, "loadId" | "documentAssets">,
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

/** Subset of the dispatcher `LoadRecord` used by the driver portal. */
export type DriverLoadRecord = {
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
  internalNotes?: string;
  pickupFacility?: string;
  pickupAddress?: string;
  pickupCity?: string;
  pickupState?: string;
  pickupZip?: string;
  pickupDate?: string;
  pickupWindowStart?: string;
  pickupWindowEnd?: string;
  pickupAppointmentTime?: string;
  pickupInstructions?: string;
  deliveryFacility?: string;
  deliveryAddress?: string;
  deliveryCity?: string;
  deliveryState?: string;
  deliveryZip?: string;
  deliveryDate?: string;
  deliveryWindowStart?: string;
  deliveryWindowEnd?: string;
  deliveryAppointmentTime?: string;
  deliveryInstructions?: string;
  commodityDescription?: string;
  weight?: string;
  weightUnit?: "lbs" | "kg";
  customerRate?: string;
  carrierRate?: string;
  linehaulRate?: string;
  assignedCarrier?: string;
  assignedDriver?: string;
  /** Driver portal workflow step (schemaless Dynamo field). */
  driverWorkflowStatus?: string;
  /** Chronological driver "Mark as" / accept events for ops notifications. */
  driverStatusHistory?: Array<{
    status: string;
    at: string;
    by?: string;
    byName?: string;
  }>;
  documents?: string[];
  /** Driver-uploaded BOL/POD assets (compressed data URLs for preview). */
  documentAssets?: LoadDocumentAsset[];
  /** Live device GPS from driver portal (Tracking Map). */
  driverGps?: import("./device-location").DriverGpsPing;
  trackingRequired?: boolean;
};

/**
 * Loads assigned to the signed-in driver.
 *
 * `driverId` is no longer a parameter: the server takes it from the token, so
 * there is nothing for a caller to get wrong or substitute.
 */
export async function listDriverLoads(): Promise<DriverLoadRecord[]> {
  return apiListDriverLoads();
}

/** `null` when the load does not exist *or* is not assigned to this driver. */
export async function getLoadById(loadId: string): Promise<DriverLoadRecord | null> {
  return apiGetDriverLoad(loadId);
}

/**
 * Write the driver-owned attributes of an assigned load.
 *
 * The allowlist and the ownership condition both live on the server now. This
 * warns about oversized documents and passes the patch through.
 */
export async function patchLoadRecord(
  loadId: string,
  attributes: Partial<DriverLoadRecord>,
): Promise<DriverLoadRecord> {
  if (attributes.documentAssets) {
    warnIfLoadDocumentsOversized({ loadId, documentAssets: attributes.documentAssets });
  }
  return apiPatchDriverLoad(loadId, attributes);
}
