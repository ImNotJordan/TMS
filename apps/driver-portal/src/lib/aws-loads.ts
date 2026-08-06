import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

import {
  getDynamoDocClient,
  getLoadsTableName,
  isLoadsConfigured,
  scanAllTableItems,
} from "./dynamodb";
import { createRateLimitedExecutor } from "./rate-limit";
import type { LoadDocumentAsset } from "./load-documents";

export type { LoadDocumentAsset };

const READ_MS = 300;
const WRITE_MS = 1200;
const runRead = createRateLimitedExecutor(READ_MS);
const runWrite = createRateLimitedExecutor(WRITE_MS);

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

function describeError(err: unknown, op: string): Error {
  if (err instanceof Error) {
    const awsName = (err as { name?: string }).name;
    const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    const detail = [awsName && `${awsName}`, status && `HTTP ${status}`, err.message]
      .filter(Boolean)
      .join(" · ");
    console.error(`[DynamoDB Loads ${op}]`, err);
    return new Error(`DynamoDB ${op} failed: ${detail}`);
  }
  console.error(`[DynamoDB Loads ${op}]`, err);
  return new Error(`DynamoDB ${op} failed`);
}

export async function listAllLoads(): Promise<DriverLoadRecord[]> {
  if (!isLoadsConfigured()) {
    throw new Error("Loads table / Identity Pool is not configured.");
  }
  return runRead(async () => {
    try {
      const client = await getDynamoDocClient();
      return await scanAllTableItems<DriverLoadRecord>(client, {
        TableName: getLoadsTableName(),
      });
    } catch (err) {
      throw describeError(err, "Scan");
    }
  });
}

export async function getLoadById(loadId: string): Promise<DriverLoadRecord | null> {
  const id = loadId.trim();
  if (!id) return null;
  if (!isLoadsConfigured()) return null;

  return runRead(async () => {
    try {
      const client = await getDynamoDocClient();
      const out = await client.send(
        new GetCommand({
          TableName: getLoadsTableName(),
          Key: { loadId: id },
        }),
      );
      return (out.Item as DriverLoadRecord | undefined) ?? null;
    } catch (err) {
      throw describeError(err, "GetItem");
    }
  });
}

export async function updateLoadRecord(record: DriverLoadRecord): Promise<DriverLoadRecord> {
  if (!record.loadId?.trim()) throw new Error("loadId is required");
  warnIfLoadDocumentsOversized(record);
  return runWrite(async () => {
    try {
      const client = await getDynamoDocClient();
      const item: DriverLoadRecord = {
        ...record,
        updatedAt: new Date().toISOString(),
      };
      await client.send(
        new PutCommand({
          TableName: getLoadsTableName(),
          Item: item,
          ConditionExpression: "attribute_exists(loadId)",
        }),
      );
      return item;
    } catch (err) {
      throw describeError(err, "PutItem(update)");
    }
  });
}
