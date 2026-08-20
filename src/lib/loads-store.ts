import { QueryCommand } from "@aws-sdk/lib-dynamodb";

import { createDynamoEntityStore, describeDynamoError } from "./dynamo-entity-store";
import { getDynamoDocClient, getLoadsTableName, queryAllItems } from "./dynamodb";

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

export function warnIfLoadDocumentsOversized(record: Pick<LoadRecord, "loadId" | "documentAssets">) {
  const assets = record.documentAssets;
  if (!assets?.length) return;
  let total = 0;
  for (const asset of assets) {
    total += asset.dataUrl?.length ?? 0;
  }
  if (total > LOAD_DOCUMENT_DATA_URL_SOFT_LIMIT) {
    console.warn(
      "[Loads] document data-URL payload near Dynamo item limit",
      { loadId: record.loadId, chars: total, softLimit: LOAD_DOCUMENT_DATA_URL_SOFT_LIMIT },
    );
  }
}

const store = createDynamoEntityStore<LoadRecord>({
  tableName: getLoadsTableName,
  idKey: "loadId",
  label: "Loads",
  kind: "loads",
  normalizeCreate: (input, now) => {
    const item = { ...input, createdAt: now, updatedAt: now } as LoadRecord;
    warnIfLoadDocumentsOversized(item);
    return item;
  },
  normalizeUpdate: (record, now) => {
    const item = { ...record, updatedAt: now };
    warnIfLoadDocumentsOversized(item);
    return item;
  },
});

export const createLoad = store.create;
export const listAllLoads = store.listAll;
export const listAllLoadsCached = store.listAllCached;
export const getLoadById = store.getById;
export const getLoadByIdCached = store.getByIdCached;
export const updateLoad = store.update;
export const deleteLoad = store.remove;

export async function listLoadsByUser(userId: string): Promise<LoadRecord[]> {
  return store.runReadLimited(async () => {
    try {
      const client = await getDynamoDocClient();
      return await queryAllItems<LoadRecord>(client, {
        TableName: getLoadsTableName(),
        IndexName: "createdBy-index",
        KeyConditionExpression: "createdBy = :u",
        ExpressionAttributeValues: { ":u": userId },
      });
    } catch (err) {
      throw describeDynamoError(err, "Query", "Loads");
    }
  });
}
