import type {
  BackhaulCandidate,
  HistoricalResultRow,
  LeverageLoad,
  SearchCriteria,
  SearchOptions,
} from "./bidding-data";

const STORAGE_PREFIX = "titan-freight:bidding-page:";

export type BiddingSearchSessionCache = {
  searchCriteria: SearchCriteria;
  searchOptions: SearchOptions;
  selectedResultId: string;
  results: HistoricalResultRow[];
  similarActiveLoads: LeverageLoad[];
  backhaulCandidates: BackhaulCandidate[];
  loadsFingerprint: string;
  cachedAt: string;
};

type BiddingPageCache = {
  search?: BiddingSearchSessionCache;
};

const memoryByWorkspace = new Map<string, BiddingPageCache>();

function canUseSessionStorage() {
  return typeof window !== "undefined" && typeof sessionStorage !== "undefined";
}

function storageKey(workspaceId: string) {
  return `${STORAGE_PREFIX}${workspaceId}`;
}

function readSession(workspaceId: string): BiddingPageCache | null {
  if (!canUseSessionStorage()) return null;
  try {
    const raw = sessionStorage.getItem(storageKey(workspaceId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BiddingPageCache;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writeSession(workspaceId: string, cache: BiddingPageCache) {
  if (!canUseSessionStorage()) return;
  try {
    sessionStorage.setItem(storageKey(workspaceId), JSON.stringify(cache));
  } catch {
    // ignore quota errors
  }
}

function getPageCache(workspaceId: string): BiddingPageCache {
  let cache = memoryByWorkspace.get(workspaceId);
  if (!cache) {
    cache = readSession(workspaceId) ?? {};
    memoryByWorkspace.set(workspaceId, cache);
  }
  return cache;
}

export function readBiddingSearchSessionCache(
  workspaceId: string,
): BiddingSearchSessionCache | undefined {
  return getPageCache(workspaceId).search;
}

export function writeBiddingSearchSessionCache(
  workspaceId: string,
  entry: BiddingSearchSessionCache,
): void {
  const cache = { ...getPageCache(workspaceId), search: entry };
  memoryByWorkspace.set(workspaceId, cache);
  writeSession(workspaceId, cache);
}

export function clearBiddingSearchSessionCache(workspaceId: string): void {
  const cache = { ...getPageCache(workspaceId) };
  delete cache.search;
  memoryByWorkspace.set(workspaceId, cache);
  writeSession(workspaceId, cache);
}

export function clearBiddingPageCache(workspaceId: string): void {
  memoryByWorkspace.delete(workspaceId);
  if (!canUseSessionStorage()) return;
  try {
    sessionStorage.removeItem(storageKey(workspaceId));
  } catch {
    // ignore
  }
}
