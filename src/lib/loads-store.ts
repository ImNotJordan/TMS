import { GetCommand, PutCommand, QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";

import { getDynamoDocClient, getLoadsTableName } from "./dynamodb";
import { createRateLimitedExecutor } from "./rate-limit";

const LOADS_READ_RATE_LIMIT_MS = 300;
const LOADS_WRITE_RATE_LIMIT_MS = 1200;

export type LoadRecord = {
  loadId: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  // Step 1
  loadType?: string;
  loadStatus?: string;
  customer?: string;
  broker?: string;
  dispatcher?: string;
  equipmentType?: string;
  trailerType?: string;
  loadPriority?: string;
  internalNotes?: string;
  // Step 2: pickup
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
  // Step 2b: delivery
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
  // Step 3: freight
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
  // Step 4: pricing
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
  // Step 5: carrier/driver
  assignedCarrier?: string;
  assignedDriver?: string;
  // Step 6: docs + tracking
  trackingRequired?: boolean;
  trackingMethod?: string;
  checkInRequired?: boolean;
  checkOutRequired?: boolean;
  documents?: string[];
  insuranceVerified?: boolean;
  authorityVerified?: boolean;
  highValueFlag?: boolean;
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

const runReadLimited = createRateLimitedExecutor(LOADS_READ_RATE_LIMIT_MS);
const runWriteLimited = createRateLimitedExecutor(LOADS_WRITE_RATE_LIMIT_MS);

export type CreateLoadInput = Omit<LoadRecord, "createdAt" | "updatedAt">;

export async function createLoad(input: CreateLoadInput): Promise<LoadRecord> {
  if (!input.loadId) {
    throw new Error("loadId is required to create a load");
  }
  return runWriteLimited(async () => {
    try {
      const client = await getDynamoDocClient();
      const now = new Date().toISOString();
      const item: LoadRecord = {
        ...input,
        createdAt: now,
        updatedAt: now,
      };
      await client.send(
        new PutCommand({
          TableName: getLoadsTableName(),
          Item: item,
          ConditionExpression: "attribute_not_exists(loadId)",
        }),
      );
      return item;
    } catch (err) {
      throw describeError(err, "PutItem");
    }
  });
}

export async function listLoadsByUser(userId: string): Promise<LoadRecord[]> {
  return runReadLimited(async () => {
    try {
      const client = await getDynamoDocClient();
      const out = await client.send(
        new QueryCommand({
          TableName: getLoadsTableName(),
          IndexName: "createdBy-index",
          KeyConditionExpression: "createdBy = :u",
          ExpressionAttributeValues: { ":u": userId },
        }),
      );
      return (out.Items as LoadRecord[] | undefined) ?? [];
    } catch (err) {
      throw describeError(err, "Query");
    }
  });
}

export async function listAllLoads(): Promise<LoadRecord[]> {
  return runReadLimited(async () => {
    try {
      const client = await getDynamoDocClient();
      const out = await client.send(new ScanCommand({ TableName: getLoadsTableName() }));
      return (out.Items as LoadRecord[] | undefined) ?? [];
    } catch (err) {
      throw describeError(err, "Scan");
    }
  });
}

export async function getLoadById(loadId: string): Promise<LoadRecord | null> {
  if (!loadId?.trim()) {
    throw new Error("loadId is required");
  }
  return runReadLimited(async () => {
    try {
      const client = await getDynamoDocClient();
      const out = await client.send(
        new GetCommand({
          TableName: getLoadsTableName(),
          Key: { loadId: loadId.trim() },
        }),
      );
      const item = out.Item as LoadRecord | undefined;
      return item ?? null;
    } catch (err) {
      throw describeError(err, "GetItem");
    }
  });
}

/** Replace an existing load item (preserves `createdAt` / `createdBy` from `record`). */
export async function updateLoad(record: LoadRecord): Promise<LoadRecord> {
  if (!record.loadId?.trim()) {
    throw new Error("loadId is required");
  }
  return runWriteLimited(async () => {
    try {
      const client = await getDynamoDocClient();
      const now = new Date().toISOString();
      const item: LoadRecord = {
        ...record,
        updatedAt: now,
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
