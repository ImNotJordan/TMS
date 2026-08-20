import { createApiBackedStore } from "./api/api-backed-store";
import {
  getAwsRegion,
  getQuotesTableName,
  isDynamoAccessDenied,
  isDynamoResourceNotFound,
} from "./dynamodb";

export const QUOTE_STATUS_VALUES = [
  "Draft",
  "Pending",
  "Sent",
  "Accepted",
  "Rejected",
  "Expired",
  "Converted",
] as const;

export type QuoteStatus = (typeof QUOTE_STATUS_VALUES)[number];

export type QuoteRecord = {
  quoteId: string;
  customer: string;
  origin: string;
  destination: string;
  stops: string;
  equipment: string;
  pickupDate: string;
  deliveryDate: string;
  baseRate: number;
  fuelSurcharge: number;
  accessorials: number;
  riskScore: number;
  aiNotes: string;
  status: QuoteStatus;
  routeApproved: boolean;
  routingGuideAttached: boolean;
  convertedLoadIds: string[];
  owner: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateQuoteInput = Omit<
  QuoteRecord,
  "createdAt" | "updatedAt" | "convertedLoadIds" | "routeApproved" | "routingGuideAttached"
> & {
  convertedLoadIds?: string[];
  routeApproved?: boolean;
  routingGuideAttached?: boolean;
};

function generateQuoteId(): string {
  return `Q-${Math.floor(100000 + Math.random() * 900000)}`;
}

export function totalRate(
  record: Pick<QuoteRecord, "baseRate" | "fuelSurcharge" | "accessorials">,
) {
  return (record.baseRate || 0) + (record.fuelSurcharge || 0) + (record.accessorials || 0);
}

function mapQuoteError(err: unknown, op: string): Error {
  if (err instanceof Error) {
    if (isDynamoResourceNotFound(err)) {
      const table = getQuotesTableName();
      const awsRegion = getAwsRegion() ?? "your AWS region";
      return new Error(
        `DynamoDB table "${table}" was not found in ${awsRegion}. ` +
          `Create it with partition key "quoteId" (String), then set VITE_QUOTES_TABLE_NAME=${table} in .env.`,
      );
    }
    if (isDynamoAccessDenied(err)) {
      return new Error(
        `Access denied for DynamoDB table "${getQuotesTableName()}". ` +
          `Add dynamodb:Scan, GetItem, PutItem, and DeleteItem to the authenticated Identity Pool role.`,
      );
    }
  }
  return err instanceof Error ? err : new Error(`DynamoDB ${op} failed`);
}

const store = createApiBackedStore<QuoteRecord>({
  resource: "quotes",
  keys: { collection: "quotes", item: "quote" },
  idKey: "quoteId",
  kind: "quotes",
});

export async function createQuote(input: CreateQuoteInput): Promise<QuoteRecord> {
  if (!input.customer?.trim()) {
    throw new Error("customer is required");
  }
  try {
    return await store.create({
      ...input,
      quoteId: input.quoteId?.trim() || generateQuoteId(),
      customer: input.customer.trim(),
      convertedLoadIds: input.convertedLoadIds ?? [],
      routeApproved: input.routeApproved ?? false,
      routingGuideAttached: input.routingGuideAttached ?? false,
    });
  } catch (err) {
    throw mapQuoteError(err, "PutItem");
  }
}

export async function listAllQuotes(): Promise<QuoteRecord[]> {
  try {
    return await store.listAll();
  } catch (err) {
    throw mapQuoteError(err, "Scan");
  }
}

export async function listAllQuotesCached(options?: {
  force?: boolean;
  scope?: string;
}): Promise<QuoteRecord[]> {
  try {
    return await store.listAllCached(options);
  } catch (err) {
    throw mapQuoteError(err, "Scan");
  }
}

export async function getQuoteById(quoteId: string): Promise<QuoteRecord | null> {
  try {
    return await store.getById(quoteId);
  } catch (err) {
    throw mapQuoteError(err, "GetItem");
  }
}

export async function updateQuote(record: QuoteRecord): Promise<QuoteRecord> {
  try {
    return await store.update({ ...record, quoteId: record.quoteId.trim() });
  } catch (err) {
    throw mapQuoteError(err, "PutItem(update)");
  }
}

export async function deleteQuote(quoteId: string): Promise<void> {
  try {
    await store.remove(quoteId);
  } catch (err) {
    throw mapQuoteError(err, "DeleteItem");
  }
}
