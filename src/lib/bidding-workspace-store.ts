import { DeleteCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

import type { SearchCriteria } from "./bidding-data";
import {
  getAwsRegion,
  getBiddingWorkspaceTableName,
  getDynamoDocClient,
  isBiddingWorkspaceConfigured,
  isDynamoAccessDenied,
  isDynamoResourceNotFound,
  queryAllItems,
} from "./dynamodb";
import { createRateLimitedExecutor } from "./rate-limit";

const READ_RATE_LIMIT_MS = 300;
const WRITE_RATE_LIMIT_MS = 800;

const runReadLimited = createRateLimitedExecutor(READ_RATE_LIMIT_MS);
const runWriteLimited = createRateLimitedExecutor(WRITE_RATE_LIMIT_MS);

export type BidQuoteStatus = "draft" | "saved" | "sent" | "approved" | "attached";

export type BidQuoteRecord = {
  workspaceId: string;
  itemKey: string;
  recordType: "quote";
  quoteId: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  status: BidQuoteStatus;
  bidAmount: number;
  buyRate: number;
  margin: number;
  originCity: string;
  originState: string;
  destinationCity: string;
  destinationState: string;
  equipmentType: string;
  laneLabel?: string;
  internalNote?: string;
  riskModelId?: string;
  riskModelVersion?: string;
  riskScore?: number;
  riskLevel?: string;
  rfpId?: string;
  rfpLane?: string;
  finalBid?: string;
  searchCriteria?: SearchCriteria;
};

export type BiddingSavedSearchRecord = {
  workspaceId: string;
  itemKey: string;
  recordType: "search";
  searchName: string;
  criteria: SearchCriteria;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
};

export type BiddingAuditRecord = {
  workspaceId: string;
  itemKey: string;
  recordType: "audit";
  createdAt: string;
  searchId: string;
  user: string;
  origin: string;
  destination: string;
  equipment: string;
  date: string;
  historicalAggregationTimestamp: string;
  datRefreshTimestamp: string;
  riskModelId: string;
  riskModelVersion: string;
  riskInputValues: string;
  riskOutput: string;
  aiSuggestionTimestamp: string;
  finalSelectedBid: string;
  actionTaken: string;
  createdQuoteId: string;
  attachedRfpId: string;
};

const QUOTE_PREFIX = "quote#";
const SEARCH_PREFIX = "search#";
const AUDIT_PREFIX = "audit#";

const CACHE_PREFIX = "titan-freight:bidding-workspace:";

let workspaceTableUnavailable = false;
let workspaceTableMissingLogged = false;

type WorkspaceCacheEntry = {
  snapshot: BiddingWorkspaceSnapshot;
  fingerprint: string;
  loadedAt: string;
};

const memoryCache = new Map<string, WorkspaceCacheEntry>();
const inflight = new Map<string, Promise<BiddingWorkspaceSnapshot>>();

export type BiddingWorkspaceSnapshot = {
  quotes: BidQuoteRecord[];
  searches: BiddingSavedSearchRecord[];
  audit: BiddingAuditRecord[];
};

function canUseSessionStorage() {
  return typeof window !== "undefined" && typeof sessionStorage !== "undefined";
}

function cacheStorageKey(workspaceId: string) {
  return `${CACHE_PREFIX}${workspaceId}`;
}

function snapshotFingerprint(snapshot: BiddingWorkspaceSnapshot): string {
  const parts = [
    ...snapshot.quotes.map((quote) => `${quote.quoteId}:${quote.updatedAt}`),
    ...snapshot.searches.map((search) => `${search.searchName}:${search.updatedAt}`),
    ...snapshot.audit.map((entry) => `${entry.itemKey}:${entry.createdAt}`),
  ].sort();
  return parts.length > 0 ? parts.join("|") : "0";
}

function cloneSnapshot(snapshot: BiddingWorkspaceSnapshot): BiddingWorkspaceSnapshot {
  return {
    quotes: [...snapshot.quotes],
    searches: [...snapshot.searches],
    audit: [...snapshot.audit],
  };
}

function readSessionCache(workspaceId: string): WorkspaceCacheEntry | null {
  if (!canUseSessionStorage()) return null;
  try {
    const raw = sessionStorage.getItem(cacheStorageKey(workspaceId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WorkspaceCacheEntry;
    if (!parsed?.snapshot) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeSessionCache(workspaceId: string, entry: WorkspaceCacheEntry) {
  if (!canUseSessionStorage()) return;
  try {
    sessionStorage.setItem(cacheStorageKey(workspaceId), JSON.stringify(entry));
  } catch {
    // ignore quota errors
  }
}

function readWorkspaceCache(workspaceId: string): WorkspaceCacheEntry | undefined {
  const memory = memoryCache.get(workspaceId);
  if (memory) return memory;
  const session = readSessionCache(workspaceId);
  if (session) {
    memoryCache.set(workspaceId, session);
    return session;
  }
  return undefined;
}

function writeWorkspaceCache(workspaceId: string, snapshot: BiddingWorkspaceSnapshot) {
  const entry: WorkspaceCacheEntry = {
    snapshot: cloneSnapshot(snapshot),
    fingerprint: snapshotFingerprint(snapshot),
    loadedAt: new Date().toISOString(),
  };
  memoryCache.set(workspaceId, entry);
  writeSessionCache(workspaceId, entry);
  return entry;
}

export function readBiddingWorkspaceCacheSnapshot(
  workspaceId: string,
): BiddingWorkspaceSnapshot | null {
  const cached = readWorkspaceCache(workspaceId);
  return cached ? cloneSnapshot(cached.snapshot) : null;
}

function invalidateWorkspaceSnapshot(workspaceId?: string): void {
  if (workspaceId) {
    memoryCache.delete(workspaceId);
    if (canUseSessionStorage()) {
      try {
        sessionStorage.removeItem(cacheStorageKey(workspaceId));
      } catch {
        // ignore
      }
    }
    return;
  }
  memoryCache.clear();
}

function upsertQuoteInCache(workspaceId: string, quote: BidQuoteRecord) {
  const cached = readWorkspaceCache(workspaceId);
  const snapshot = cached ? cloneSnapshot(cached.snapshot) : { quotes: [], searches: [], audit: [] };
  const index = snapshot.quotes.findIndex((row) => row.quoteId === quote.quoteId);
  if (index >= 0) snapshot.quotes[index] = quote;
  else snapshot.quotes.unshift(quote);
  snapshot.quotes = sortByRecency(snapshot.quotes);
  writeWorkspaceCache(workspaceId, snapshot);
}

function removeQuoteFromCache(workspaceId: string, quoteId: string) {
  const cached = readWorkspaceCache(workspaceId);
  if (!cached) return;
  const snapshot = cloneSnapshot(cached.snapshot);
  snapshot.quotes = snapshot.quotes.filter((quote) => quote.quoteId !== quoteId);
  writeWorkspaceCache(workspaceId, snapshot);
}

function upsertSearchInCache(workspaceId: string, search: BiddingSavedSearchRecord) {
  const cached = readWorkspaceCache(workspaceId);
  const snapshot = cached ? cloneSnapshot(cached.snapshot) : { quotes: [], searches: [], audit: [] };
  const index = snapshot.searches.findIndex((row) => row.searchName === search.searchName);
  if (index >= 0) snapshot.searches[index] = search;
  else snapshot.searches.unshift(search);
  snapshot.searches = sortByRecency(snapshot.searches);
  writeWorkspaceCache(workspaceId, snapshot);
}

function removeSearchFromCache(workspaceId: string, searchName: string) {
  const cached = readWorkspaceCache(workspaceId);
  if (!cached) return;
  const snapshot = cloneSnapshot(cached.snapshot);
  snapshot.searches = snapshot.searches.filter((search) => search.searchName !== searchName);
  writeWorkspaceCache(workspaceId, snapshot);
}

function prependAuditInCache(workspaceId: string, entry: BiddingAuditRecord) {
  const cached = readWorkspaceCache(workspaceId);
  const snapshot = cached ? cloneSnapshot(cached.snapshot) : { quotes: [], searches: [], audit: [] };
  snapshot.audit = sortByRecency([entry, ...snapshot.audit.filter((row) => row.itemKey !== entry.itemKey)]);
  writeWorkspaceCache(workspaceId, snapshot);
}

export function isBiddingWorkspaceAvailable(): boolean {
  return isBiddingWorkspaceConfigured() && !workspaceTableUnavailable;
}

export function getBiddingWorkspaceTableMissingMessage(): string | null {
  if (!isBiddingWorkspaceConfigured() || !workspaceTableUnavailable) return null;
  const table = getBiddingWorkspaceTableName();
  const awsRegion = getAwsRegion() ?? "your AWS region";
  return (
    `DynamoDB table "${table}" was not found in ${awsRegion}. ` +
    `Create it with partition key "workspaceId" (String) and sort key "itemKey" (String) ` +
    `to persist quotes, saved searches, and audit logs. Until then, workspace data stays local.`
  );
}

function markWorkspaceTableUnavailable(): void {
  workspaceTableUnavailable = true;
  invalidateWorkspaceSnapshot();
  if (!workspaceTableMissingLogged) {
    workspaceTableMissingLogged = true;
    const table = getBiddingWorkspaceTableName();
    const awsRegion = getAwsRegion() ?? "your AWS region";
    console.warn(
      `[BiddingWorkspace] DynamoDB table "${table}" was not found in ${awsRegion}. ` +
        `Using local-only mode until the table exists (keys: workspaceId + itemKey).`,
    );
  }
}

function sortByRecency<T extends { updatedAt?: string; createdAt?: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const aTime = a.updatedAt ?? a.createdAt ?? "";
    const bTime = b.updatedAt ?? b.createdAt ?? "";
    return bTime.localeCompare(aTime);
  });
}

async function fetchWorkspaceSnapshotRemote(workspaceId: string): Promise<BiddingWorkspaceSnapshot> {
  const empty: BiddingWorkspaceSnapshot = { quotes: [], searches: [], audit: [] };
  if (!isBiddingWorkspaceConfigured() || workspaceTableUnavailable) return empty;

  return runReadLimited(async () => {
    try {
      const client = await getDynamoDocClient();
      const items = await queryAllItems<
        BidQuoteRecord | BiddingSavedSearchRecord | BiddingAuditRecord
      >(client, {
        TableName: getBiddingWorkspaceTableName(),
        KeyConditionExpression: "workspaceId = :w",
        ExpressionAttributeValues: {
          ":w": workspaceId,
        },
        ScanIndexForward: false,
      });
      return splitWorkspaceItems(items);
    } catch (err) {
      if (isDynamoResourceNotFound(err)) {
        markWorkspaceTableUnavailable();
        return empty;
      }
      throw describeError(err, "Sync");
    }
  });
}

export async function fetchBiddingWorkspaceSnapshotCached(options: {
  workspaceId: string;
  force?: boolean;
}): Promise<BiddingWorkspaceSnapshot> {
  const { workspaceId, force = false } = options;
  const empty: BiddingWorkspaceSnapshot = { quotes: [], searches: [], audit: [] };

  if (!isBiddingWorkspaceConfigured() || workspaceTableUnavailable) {
    return readBiddingWorkspaceCacheSnapshot(workspaceId) ?? empty;
  }

  const cached = readWorkspaceCache(workspaceId);
  if (cached && !force) {
    return cloneSnapshot(cached.snapshot);
  }

  const pending = inflight.get(workspaceId);
  if (pending) return pending;

  const remotePromise = fetchWorkspaceSnapshotRemote(workspaceId)
    .then((snapshot) => {
      const remoteFp = snapshotFingerprint(snapshot);
      if (cached && force && cached.fingerprint === remoteFp) {
        return cloneSnapshot(cached.snapshot);
      }
      writeWorkspaceCache(workspaceId, snapshot);
      return cloneSnapshot(snapshot);
    })
    .finally(() => {
      if (inflight.get(workspaceId) === remotePromise) inflight.delete(workspaceId);
    });

  inflight.set(workspaceId, remotePromise);
  return remotePromise;
}

export async function fetchBiddingWorkspaceSnapshot(
  workspaceId: string,
): Promise<BiddingWorkspaceSnapshot> {
  return fetchBiddingWorkspaceSnapshotCached({ workspaceId });
}

function splitWorkspaceItems(
  items: Array<BidQuoteRecord | BiddingSavedSearchRecord | BiddingAuditRecord>,
): BiddingWorkspaceSnapshot {
  const quotes: BidQuoteRecord[] = [];
  const searches: BiddingSavedSearchRecord[] = [];
  const audit: BiddingAuditRecord[] = [];

  for (const item of items) {
    if (item.recordType === "quote") quotes.push(item);
    else if (item.recordType === "search") searches.push(item);
    else if (item.recordType === "audit") audit.push(item);
  }

  return {
    quotes: sortByRecency(quotes),
    searches: sortByRecency(searches),
    audit: sortByRecency(audit),
  };
}

function quoteItemKey(quoteId: string) {
  return `${QUOTE_PREFIX}${quoteId}`;
}

function searchItemKey(searchName: string) {
  return `${SEARCH_PREFIX}${searchName}`;
}

function auditItemKey(iso: string, searchId: string) {
  return `${AUDIT_PREFIX}${iso}#${searchId}`;
}

function describeError(err: unknown, op: string): Error {
  if (err instanceof Error) {
    if (isDynamoResourceNotFound(err)) {
      markWorkspaceTableUnavailable();
      const table = getBiddingWorkspaceTableName();
      const awsRegion = getAwsRegion() ?? "your AWS region";
      return new Error(
        `DynamoDB table "${table}" was not found in ${awsRegion}. ` +
          `Create it with partition key "workspaceId" (String) and sort key "itemKey" (String), ` +
          `then set VITE_BIDDING_WORKSPACE_TABLE_NAME=${table} in .env.`,
      );
    }
    if (isDynamoAccessDenied(err)) {
      return new Error(
        `Access denied for DynamoDB table "${getBiddingWorkspaceTableName()}". ` +
          `Add dynamodb:Query, PutItem, and DeleteItem on this table to your Cognito Identity Pool authenticated role.`,
      );
    }
    const awsName = (err as { name?: string }).name;
    const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    const detail = [awsName && `${awsName}`, status && `HTTP ${status}`, err.message]
      .filter(Boolean)
      .join(" · ");
    console.error(`[DynamoDB BiddingWorkspace ${op}]`, err);
    return new Error(`Bidding workspace ${op} failed: ${detail}`);
  }
  console.error(`[DynamoDB BiddingWorkspace ${op}]`, err);
  return new Error(`Bidding workspace ${op} failed`);
}

export async function listBidQuotes(workspaceId: string): Promise<BidQuoteRecord[]> {
  const snapshot = await fetchBiddingWorkspaceSnapshotCached({ workspaceId });
  return snapshot.quotes;
}

export async function listBiddingSavedSearches(
  workspaceId: string,
): Promise<BiddingSavedSearchRecord[]> {
  const snapshot = await fetchBiddingWorkspaceSnapshotCached({ workspaceId });
  return snapshot.searches;
}

export async function listBiddingAuditLogs(workspaceId: string): Promise<BiddingAuditRecord[]> {
  const snapshot = await fetchBiddingWorkspaceSnapshotCached({ workspaceId });
  return snapshot.audit;
}

export async function createBidQuote(input: {
  workspaceId: string;
  createdBy: string;
  quoteId?: string;
  status?: BidQuoteStatus;
  bidAmount: number;
  buyRate: number;
  margin: number;
  originCity: string;
  originState: string;
  destinationCity: string;
  destinationState: string;
  equipmentType: string;
  laneLabel?: string;
  internalNote?: string;
  riskModelId?: string;
  riskModelVersion?: string;
  riskScore?: number;
  riskLevel?: string;
  rfpId?: string;
  rfpLane?: string;
  finalBid?: string;
  searchCriteria?: SearchCriteria;
}): Promise<BidQuoteRecord> {
  if (!isBiddingWorkspaceAvailable()) {
    throw new Error(
      getBiddingWorkspaceTableMissingMessage() ??
        "Bidding workspace table is not configured. Set VITE_BIDDING_WORKSPACE_TABLE_NAME in .env.",
    );
  }

  const quoteId = input.quoteId ?? `QT-${Math.floor(100000 + Math.random() * 900000)}`;
  const now = new Date().toISOString();
  const item: BidQuoteRecord = {
    workspaceId: input.workspaceId,
    itemKey: quoteItemKey(quoteId),
    recordType: "quote",
    quoteId,
    createdAt: now,
    updatedAt: now,
    createdBy: input.createdBy,
    status: input.status ?? "saved",
    bidAmount: input.bidAmount,
    buyRate: input.buyRate,
    margin: input.margin,
    originCity: input.originCity,
    originState: input.originState,
    destinationCity: input.destinationCity,
    destinationState: input.destinationState,
    equipmentType: input.equipmentType,
    laneLabel: input.laneLabel,
    internalNote: input.internalNote,
    riskModelId: input.riskModelId,
    riskModelVersion: input.riskModelVersion,
    riskScore: input.riskScore,
    riskLevel: input.riskLevel,
    rfpId: input.rfpId,
    rfpLane: input.rfpLane,
    finalBid: input.finalBid,
    searchCriteria: input.searchCriteria,
  };

  return runWriteLimited(async () => {
    try {
      const client = await getDynamoDocClient();
      await client.send(
        new PutCommand({
          TableName: getBiddingWorkspaceTableName(),
          Item: item,
          ConditionExpression: "attribute_not_exists(itemKey)",
        }),
      );
      upsertQuoteInCache(input.workspaceId, item);
      return item;
    } catch (err) {
      throw describeError(err, "CreateQuote");
    }
  });
}

export async function updateBidQuote(record: BidQuoteRecord): Promise<BidQuoteRecord> {
  if (!isBiddingWorkspaceAvailable()) {
    throw new Error(
      getBiddingWorkspaceTableMissingMessage() ??
        "Bidding workspace table is not configured. Set VITE_BIDDING_WORKSPACE_TABLE_NAME in .env.",
    );
  }

  const item: BidQuoteRecord = {
    ...record,
    updatedAt: new Date().toISOString(),
  };

  return runWriteLimited(async () => {
    try {
      const client = await getDynamoDocClient();
      await client.send(
        new PutCommand({
          TableName: getBiddingWorkspaceTableName(),
          Item: item,
          ConditionExpression: "attribute_exists(itemKey)",
        }),
      );
      upsertQuoteInCache(record.workspaceId, item);
      return item;
    } catch (err) {
      throw describeError(err, "UpdateQuote");
    }
  });
}

export async function deleteBidQuote(workspaceId: string, quoteId: string): Promise<void> {
  if (!isBiddingWorkspaceAvailable()) {
    throw new Error(
      getBiddingWorkspaceTableMissingMessage() ??
        "Bidding workspace table is not configured. Set VITE_BIDDING_WORKSPACE_TABLE_NAME in .env.",
    );
  }

  return runWriteLimited(async () => {
    try {
      const client = await getDynamoDocClient();
      await client.send(
        new DeleteCommand({
          TableName: getBiddingWorkspaceTableName(),
          Key: {
            workspaceId,
            itemKey: quoteItemKey(quoteId),
          },
          ConditionExpression: "attribute_exists(itemKey)",
        }),
      );
      removeQuoteFromCache(workspaceId, quoteId);
    } catch (err) {
      throw describeError(err, "DeleteQuote");
    }
  });
}

export async function upsertBiddingSavedSearch(input: {
  workspaceId: string;
  createdBy: string;
  searchName: string;
  criteria: SearchCriteria;
}): Promise<BiddingSavedSearchRecord> {
  if (!isBiddingWorkspaceAvailable()) {
    throw new Error(
      getBiddingWorkspaceTableMissingMessage() ??
        "Bidding workspace table is not configured. Set VITE_BIDDING_WORKSPACE_TABLE_NAME in .env.",
    );
  }

  const now = new Date().toISOString();
  const item: BiddingSavedSearchRecord = {
    workspaceId: input.workspaceId,
    itemKey: searchItemKey(input.searchName),
    recordType: "search",
    searchName: input.searchName,
    criteria: input.criteria,
    createdAt: now,
    updatedAt: now,
    createdBy: input.createdBy,
  };

  return runWriteLimited(async () => {
    try {
      const client = await getDynamoDocClient();
      await client.send(
        new PutCommand({
          TableName: getBiddingWorkspaceTableName(),
          Item: item,
        }),
      );
      upsertSearchInCache(input.workspaceId, item);
      return item;
    } catch (err) {
      throw describeError(err, "UpsertSearch");
    }
  });
}

export async function deleteBiddingSavedSearch(
  workspaceId: string,
  searchName: string,
): Promise<void> {
  if (!isBiddingWorkspaceAvailable()) {
    throw new Error(
      getBiddingWorkspaceTableMissingMessage() ??
        "Bidding workspace table is not configured. Set VITE_BIDDING_WORKSPACE_TABLE_NAME in .env.",
    );
  }

  return runWriteLimited(async () => {
    try {
      const client = await getDynamoDocClient();
      await client.send(
        new DeleteCommand({
          TableName: getBiddingWorkspaceTableName(),
          Key: {
            workspaceId,
            itemKey: searchItemKey(searchName),
          },
        }),
      );
      removeSearchFromCache(workspaceId, searchName);
    } catch (err) {
      throw describeError(err, "DeleteSearch");
    }
  });
}

export async function appendBiddingAuditLog(
  workspaceId: string,
  entry: Omit<BiddingAuditRecord, "workspaceId" | "itemKey" | "recordType" | "createdAt"> & {
    createdAt?: string;
  },
): Promise<BiddingAuditRecord> {
  if (!isBiddingWorkspaceAvailable()) {
    return {
      workspaceId,
      itemKey: auditItemKey(entry.createdAt ?? new Date().toISOString(), entry.searchId),
      recordType: "audit",
      createdAt: entry.createdAt ?? new Date().toISOString(),
      ...entry,
    };
  }

  const createdAt = entry.createdAt ?? new Date().toISOString();
  const item: BiddingAuditRecord = {
    workspaceId,
    itemKey: auditItemKey(createdAt, entry.searchId),
    recordType: "audit",
    createdAt,
    searchId: entry.searchId,
    user: entry.user,
    origin: entry.origin,
    destination: entry.destination,
    equipment: entry.equipment,
    date: entry.date,
    historicalAggregationTimestamp: entry.historicalAggregationTimestamp,
    datRefreshTimestamp: entry.datRefreshTimestamp,
    riskModelId: entry.riskModelId,
    riskModelVersion: entry.riskModelVersion,
    riskInputValues: entry.riskInputValues,
    riskOutput: entry.riskOutput,
    aiSuggestionTimestamp: entry.aiSuggestionTimestamp,
    finalSelectedBid: entry.finalSelectedBid,
    actionTaken: entry.actionTaken,
    createdQuoteId: entry.createdQuoteId,
    attachedRfpId: entry.attachedRfpId,
  };

  return runWriteLimited(async () => {
    try {
      const client = await getDynamoDocClient();
      await client.send(
        new PutCommand({
          TableName: getBiddingWorkspaceTableName(),
          Item: item,
        }),
      );
      prependAuditInCache(workspaceId, item);
      return item;
    } catch (err) {
      if (isDynamoResourceNotFound(err)) {
        markWorkspaceTableUnavailable();
        return item;
      }
      throw describeError(err, "AppendAudit");
    }
  });
}

export function bidQuoteToSummary(quote: BidQuoteRecord) {
  return {
    id: quote.quoteId,
    bid: quote.bidAmount,
    margin: quote.margin,
    timestamp: quote.updatedAt,
    status: quote.status,
  };
}
