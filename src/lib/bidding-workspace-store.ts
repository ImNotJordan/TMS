/**
 * Bidding workspace — quotes, saved searches and the bidding audit trail.
 *
 * ## Transport
 *
 * `/api/bidding-workspace`, not DynamoDB. The browser holds no credentials for
 * the table.
 *
 * ## About the `workspaceId` arguments
 *
 * They are still in these signatures so no screen had to change, and they still
 * key the local cache. They are **not sent to the server**. A workspace is a
 * user, and the server takes that identity from the verified token; there is no
 * field on the wire for a workspace id, so passing someone else's sub here now
 * reads and writes your own workspace rather than theirs.
 *
 * That is the fix. Previously the id travelled from `bidding-page.tsx` —
 * `user?.userId ?? "_"` — straight into the partition key, so anyone who
 * substituted a colleague's sub got their draft quotes, saved lanes, buy rates
 * and audit history.
 */
import type { SearchCriteria } from "./bidding-data";
import { createRateLimitedExecutor } from "./rate-limit";
import { fetchAuthSession } from "aws-amplify/auth";

const READ_RATE_LIMIT_MS = 300;
const WRITE_RATE_LIMIT_MS = 800;

const runReadLimited = createRateLimitedExecutor(READ_RATE_LIMIT_MS);
const runWriteLimited = createRateLimitedExecutor(WRITE_RATE_LIMIT_MS);

const PATH = "/api/bidding-workspace";

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

/** Fields the server owns. Stripped before sending; the API rejects them. */
function withoutServerOwnedFields<T extends Record<string, unknown>>(input: T) {
  const { workspaceId: _w, companyId: _c, createdBy: _b, ...rest } = input;
  return rest;
}

async function authHeaders(): Promise<Record<string, string>> {
  try {
    const session = await fetchAuthSession();
    const token = session.tokens?.idToken?.toString();
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

async function send(path: string, init?: RequestInit): Promise<Response> {
  const headers = await authHeaders();
  return fetch(path, {
    ...init,
    headers: { ...headers, ...(init?.body ? { "content-type": "application/json" } : {}) },
  });
}

async function failure(response: Response, op: string): Promise<Error> {
  if (response.status === 503) {
    markWorkspaceTableUnavailable();
  }
  let message = `Bidding workspace ${op} failed (HTTP ${response.status})`;
  try {
    const body = (await response.json()) as { error?: string };
    if (body?.error) message = body.error;
  } catch {
    /* non-JSON error body — the status line is enough */
  }
  console.error(`[BiddingWorkspace ${op}]`, message);
  return new Error(message);
}

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

/**
 * Drop every cached workspace.
 *
 * Called on sign-out and on identity changes: the snapshot is another user's
 * commercial data once the session behind it is gone, and sessionStorage
 * outlives a client-side route change.
 */
export function clearBiddingWorkspaceCache(): void {
  invalidateWorkspaceSnapshot();
  if (!canUseSessionStorage()) return;
  try {
    for (const key of Object.keys(sessionStorage)) {
      if (key.startsWith(CACHE_PREFIX)) sessionStorage.removeItem(key);
    }
  } catch {
    // ignore
  }
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
  const snapshot = cached
    ? cloneSnapshot(cached.snapshot)
    : { quotes: [], searches: [], audit: [] };
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
  const snapshot = cached
    ? cloneSnapshot(cached.snapshot)
    : { quotes: [], searches: [], audit: [] };
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
  const snapshot = cached
    ? cloneSnapshot(cached.snapshot)
    : { quotes: [], searches: [], audit: [] };
  snapshot.audit = sortByRecency([
    entry,
    ...snapshot.audit.filter((row) => row.itemKey !== entry.itemKey),
  ]);
  writeWorkspaceCache(workspaceId, snapshot);
}

export function isBiddingWorkspaceAvailable(): boolean {
  return !workspaceTableUnavailable;
}

export function getBiddingWorkspaceTableMissingMessage(): string | null {
  if (!workspaceTableUnavailable) return null;
  return (
    "The bidding workspace table is not available on the server. " +
    "Quotes, saved searches and audit entries stay local until it is configured."
  );
}

function markWorkspaceTableUnavailable(): void {
  workspaceTableUnavailable = true;
  invalidateWorkspaceSnapshot();
  if (!workspaceTableMissingLogged) {
    workspaceTableMissingLogged = true;
    console.warn(
      "[BiddingWorkspace] server reports the workspace table is unavailable. " +
        "Using local-only mode.",
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

/** PUT one item. `mode` carries the condition the direct write used to apply. */
async function putWorkspaceItem<T extends Record<string, unknown>>(
  item: T,
  mode: "create" | "update" | "put",
  op: string,
): Promise<T> {
  const response = await send(PATH, {
    method: "PUT",
    body: JSON.stringify({ ...withoutServerOwnedFields(item), mode }),
  });
  if (!response.ok) throw await failure(response, op);
  const body = (await response.json()) as { item?: T };
  return body.item ?? item;
}

async function deleteWorkspaceItem(itemKey: string, op: string): Promise<void> {
  const response = await send(`${PATH}?itemKey=${encodeURIComponent(itemKey)}`, {
    method: "DELETE",
  });
  // Already gone is the desired end state.
  if (response.status === 404) return;
  if (!response.ok) throw await failure(response, op);
}

async function fetchWorkspaceSnapshotRemote(): Promise<BiddingWorkspaceSnapshot> {
  const empty: BiddingWorkspaceSnapshot = { quotes: [], searches: [], audit: [] };
  if (workspaceTableUnavailable) return empty;

  return runReadLimited(async () => {
    const response = await send(PATH);
    if (response.status === 503) {
      markWorkspaceTableUnavailable();
      return empty;
    }
    if (!response.ok) throw await failure(response, "Sync");
    const body = (await response.json()) as {
      items?: Array<BidQuoteRecord | BiddingSavedSearchRecord | BiddingAuditRecord>;
    };
    return splitWorkspaceItems(body.items ?? []);
  });
}

export async function fetchBiddingWorkspaceSnapshotCached(options: {
  workspaceId: string;
  force?: boolean;
}): Promise<BiddingWorkspaceSnapshot> {
  const { workspaceId, force = false } = options;
  const empty: BiddingWorkspaceSnapshot = { quotes: [], searches: [], audit: [] };

  if (workspaceTableUnavailable) {
    return readBiddingWorkspaceCacheSnapshot(workspaceId) ?? empty;
  }

  const cached = readWorkspaceCache(workspaceId);
  if (cached && !force) {
    return cloneSnapshot(cached.snapshot);
  }

  const pending = inflight.get(workspaceId);
  if (pending) return pending;

  const remotePromise = fetchWorkspaceSnapshotRemote()
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
      getBiddingWorkspaceTableMissingMessage() ?? "Bidding workspace is not available.",
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
    const saved = await putWorkspaceItem(item, "create", "CreateQuote");
    upsertQuoteInCache(input.workspaceId, saved);
    return saved;
  });
}

export async function updateBidQuote(record: BidQuoteRecord): Promise<BidQuoteRecord> {
  if (!isBiddingWorkspaceAvailable()) {
    throw new Error(
      getBiddingWorkspaceTableMissingMessage() ?? "Bidding workspace is not available.",
    );
  }

  const item: BidQuoteRecord = {
    ...record,
    updatedAt: new Date().toISOString(),
  };

  return runWriteLimited(async () => {
    const saved = await putWorkspaceItem(item, "update", "UpdateQuote");
    upsertQuoteInCache(record.workspaceId, saved);
    return saved;
  });
}

export async function deleteBidQuote(workspaceId: string, quoteId: string): Promise<void> {
  if (!isBiddingWorkspaceAvailable()) {
    throw new Error(
      getBiddingWorkspaceTableMissingMessage() ?? "Bidding workspace is not available.",
    );
  }

  return runWriteLimited(async () => {
    await deleteWorkspaceItem(quoteItemKey(quoteId), "DeleteQuote");
    removeQuoteFromCache(workspaceId, quoteId);
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
      getBiddingWorkspaceTableMissingMessage() ?? "Bidding workspace is not available.",
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
    const saved = await putWorkspaceItem(item, "put", "UpsertSearch");
    upsertSearchInCache(input.workspaceId, saved);
    return saved;
  });
}

export async function deleteBiddingSavedSearch(
  workspaceId: string,
  searchName: string,
): Promise<void> {
  if (!isBiddingWorkspaceAvailable()) {
    throw new Error(
      getBiddingWorkspaceTableMissingMessage() ?? "Bidding workspace is not available.",
    );
  }

  return runWriteLimited(async () => {
    await deleteWorkspaceItem(searchItemKey(searchName), "DeleteSearch");
    removeSearchFromCache(workspaceId, searchName);
  });
}

export async function appendBiddingAuditLog(
  workspaceId: string,
  entry: Omit<BiddingAuditRecord, "workspaceId" | "itemKey" | "recordType" | "createdAt"> & {
    createdAt?: string;
  },
): Promise<BiddingAuditRecord> {
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

  if (!isBiddingWorkspaceAvailable()) return item;

  return runWriteLimited(async () => {
    try {
      const saved = await putWorkspaceItem(item, "put", "AppendAudit");
      prependAuditInCache(workspaceId, saved);
      return saved;
    } catch (err) {
      // An audit entry must never break the action it records.
      if (workspaceTableUnavailable) return item;
      throw err;
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
