import { createDynamoEntityStore } from "./dynamo-entity-store";
import {
  getAwsRegion,
  getRfpsTableName,
  isDynamoAccessDenied,
  isDynamoResourceNotFound,
} from "./dynamodb";

export const RFP_STATUS_VALUES = [
  "Draft",
  "Uploaded",
  "Mapping Required",
  "Normalized",
  "Pricing",
  "Ready for Review",
  "Approval Pending",
  "Approved",
  "Quotes Created",
  "Exported",
  "Submitted",
  "Archived",
] as const;

export type RfpStatus = (typeof RFP_STATUS_VALUES)[number];
export type RfpFileType = "XLSX" | "XLS" | "CSV";

export type RfpRecord = {
  rfpId: string;
  rfpName: string;
  customer: string;
  fileType: RfpFileType;
  laneCount: number;
  status: RfpStatus;
  pricingProgress: number;
  owner: string;
  approver: string;
  uploadDate: string;
  lastModified: string;
  dueDate: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateRfpInput = Omit<
  RfpRecord,
  "createdAt" | "updatedAt" | "lastModified" | "uploadDate"
> & {
  uploadDate?: string;
  lastModified?: string;
};

function formatDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(date: Date): string {
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function generateRfpId(): string {
  return `RFP-${Math.floor(100000 + Math.random() * 900000)}`;
}

function mapRfpError(err: unknown, op: string): Error {
  if (err instanceof Error) {
    if (isDynamoResourceNotFound(err)) {
      const table = getRfpsTableName();
      const awsRegion = getAwsRegion() ?? "your AWS region";
      return new Error(
        `DynamoDB table "${table}" was not found in ${awsRegion}. ` +
          `Create it with partition key "rfpId" (String), then set VITE_RFPS_TABLE_NAME=${table} in .env.`,
      );
    }
    if (isDynamoAccessDenied(err)) {
      return new Error(
        `Access denied for DynamoDB table "${getRfpsTableName()}". ` +
          `Add dynamodb:Scan, GetItem, PutItem, and DeleteItem to the authenticated Identity Pool role.`,
      );
    }
  }
  return err instanceof Error ? err : new Error(`DynamoDB ${op} failed`);
}

const store = createDynamoEntityStore<RfpRecord>({
  tableName: getRfpsTableName,
  idKey: "rfpId",
  label: "RFPs",
  kind: "rfps",
  normalizeUpdate: (record, now) => ({
    ...record,
    updatedAt: now,
    lastModified: formatDateTime(new Date(now)),
  }),
});

export async function createRfp(input: CreateRfpInput): Promise<RfpRecord> {
  if (!input.rfpName?.trim()) {
    throw new Error("rfpName is required");
  }
  const now = new Date();
  try {
    return await store.create({
      ...input,
      rfpId: input.rfpId?.trim() || generateRfpId(),
      rfpName: input.rfpName.trim(),
      customer: input.customer.trim(),
      uploadDate: input.uploadDate?.trim() || formatDate(now),
      lastModified: input.lastModified?.trim() || formatDateTime(now),
    });
  } catch (err) {
    throw mapRfpError(err, "PutItem");
  }
}

export async function listAllRfps(): Promise<RfpRecord[]> {
  try {
    return await store.listAll();
  } catch (err) {
    throw mapRfpError(err, "Scan");
  }
}

export async function listAllRfpsCached(options?: {
  force?: boolean;
  scope?: string;
}): Promise<RfpRecord[]> {
  try {
    return await store.listAllCached(options);
  } catch (err) {
    throw mapRfpError(err, "Scan");
  }
}

export async function getRfpById(rfpId: string): Promise<RfpRecord | null> {
  try {
    return await store.getById(rfpId);
  } catch (err) {
    throw mapRfpError(err, "GetItem");
  }
}

export async function updateRfp(record: RfpRecord): Promise<RfpRecord> {
  try {
    return await store.update({ ...record, rfpId: record.rfpId.trim() });
  } catch (err) {
    throw mapRfpError(err, "PutItem(update)");
  }
}

export async function deleteRfp(rfpId: string): Promise<void> {
  try {
    await store.remove(rfpId);
  } catch (err) {
    throw mapRfpError(err, "DeleteItem");
  }
}
