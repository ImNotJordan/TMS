export type OperationalListKind =
  | "loads"
  | "trucks"
  | "carriers"
  | "quotes"
  | "rfps"
  | "invoices"
  | "crmAccounts"
  | "crmContacts"
  | "crmLeads"
  | "crmActivities"
  | "crmCampaigns"
  | "crmProspecting"
  | "riskModels";

type VersionedRecord = { updatedAt: string };

export type OperationalListCacheEntry<T extends VersionedRecord> = {
  items: T[];
  /** Stable fingerprint of id + updatedAt pairs — detects adds/updates/deletes. */
  fingerprint: string;
  /** Max `updatedAt` across items. */
  version: string;
  /** Wall-clock when this entry was written (for TTL). */
  fetchedAt: number;
};

/** Soft TTL — stale entries revalidate on next listAllCached unless force. */
export const OPERATIONAL_LIST_CACHE_TTL_MS = 60_000;

const ALL_KINDS: OperationalListKind[] = [
  "loads",
  "trucks",
  "carriers",
  "quotes",
  "rfps",
  "invoices",
  "crmAccounts",
  "crmContacts",
  "crmLeads",
  "crmActivities",
  "crmCampaigns",
  "crmProspecting",
  "riskModels",
];

function emptyKindMaps(): Record<
  OperationalListKind,
  Map<string, OperationalListCacheEntry<VersionedRecord>>
> {
  return Object.fromEntries(ALL_KINDS.map((k) => [k, new Map()])) as Record<
    OperationalListKind,
    Map<string, OperationalListCacheEntry<VersionedRecord>>
  >;
}

function emptyItemMaps(): Record<OperationalListKind, Map<string, Map<string, VersionedRecord>>> {
  return Object.fromEntries(ALL_KINDS.map((k) => [k, new Map()])) as Record<
    OperationalListKind,
    Map<string, Map<string, VersionedRecord>>
  >;
}

const memoryLists = emptyKindMaps();
const memoryItems = emptyItemMaps();

const inflightLists = new Map<string, Promise<unknown>>();

const STORAGE_PREFIX: Record<OperationalListKind, string> = {
  loads: "titan-freight:loads-list:",
  trucks: "titan-freight:trucks-list:",
  carriers: "titan-freight:carriers-list:",
  quotes: "titan-freight:quotes-list:",
  rfps: "titan-freight:rfps-list:",
  invoices: "titan-freight:invoices-list:",
  crmAccounts: "titan-freight:crm-accounts-list:",
  crmContacts: "titan-freight:crm-contacts-list:",
  crmLeads: "titan-freight:crm-leads-list:",
  crmActivities: "titan-freight:crm-activities-list:",
  crmCampaigns: "titan-freight:crm-campaigns-list:",
  crmProspecting: "titan-freight:crm-prospecting-list:",
  riskModels: "titan-freight:risk-models-list:",
};

const LIST_ID_GETTERS: Record<OperationalListKind, (item: VersionedRecord) => string> = {
  loads: (item) => (item as unknown as { loadId: string }).loadId,
  trucks: (item) => (item as unknown as { truckBoardId: string }).truckBoardId,
  carriers: (item) => (item as unknown as { carrierId: string }).carrierId,
  quotes: (item) => (item as unknown as { quoteId: string }).quoteId,
  rfps: (item) => (item as unknown as { rfpId: string }).rfpId,
  invoices: (item) => (item as unknown as { invoiceId: string }).invoiceId,
  crmAccounts: (item) => (item as unknown as { accountId: string }).accountId,
  crmContacts: (item) => (item as unknown as { contactId: string }).contactId,
  crmLeads: (item) => (item as unknown as { leadId: string }).leadId,
  crmActivities: (item) => (item as unknown as { activityId: string }).activityId,
  crmCampaigns: (item) => (item as unknown as { campaignId: string }).campaignId,
  crmProspecting: (item) => (item as unknown as { runId: string }).runId,
  riskModels: (item) => (item as unknown as { id: string }).id,
};

let cacheScope = "_";

function canUseSessionStorage() {
  return typeof window !== "undefined" && typeof sessionStorage !== "undefined";
}

export function setOperationalCacheScope(userId: string | null | undefined) {
  cacheScope = userId?.trim() ? userId.trim() : "_";
}

export function getOperationalCacheScope() {
  return cacheScope;
}

export function listFingerprint<T extends VersionedRecord>(
  items: T[],
  getId: (item: T) => string,
): string {
  if (items.length === 0) return "0";
  return items
    .map((item) => `${getId(item)}:${item.updatedAt}`)
    .sort()
    .join("|");
}

export function maxUpdatedAt<T extends VersionedRecord>(items: T[]): string {
  let max = "";
  for (const item of items) {
    if (item.updatedAt > max) max = item.updatedAt;
  }
  return max || new Date().toISOString();
}

function listStorageKey(kind: OperationalListKind, scope: string) {
  return `${STORAGE_PREFIX[kind]}${scope}`;
}

function isCacheFresh(entry: OperationalListCacheEntry<VersionedRecord>): boolean {
  const fetchedAt = entry.fetchedAt ?? 0;
  if (!fetchedAt) return false;
  return Date.now() - fetchedAt < OPERATIONAL_LIST_CACHE_TTL_MS;
}

function readListSession<T extends VersionedRecord>(
  kind: OperationalListKind,
  scope: string,
): OperationalListCacheEntry<T> | null {
  if (!canUseSessionStorage()) return null;
  try {
    const raw = sessionStorage.getItem(listStorageKey(kind, scope));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OperationalListCacheEntry<T>;
    if (!parsed?.items || !Array.isArray(parsed.items)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeListSession<T extends VersionedRecord>(
  kind: OperationalListKind,
  scope: string,
  entry: OperationalListCacheEntry<T>,
) {
  if (!canUseSessionStorage()) return;
  try {
    sessionStorage.setItem(listStorageKey(kind, scope), JSON.stringify(entry));
  } catch {
    // ignore quota errors
  }
}

function readListCache<T extends VersionedRecord>(
  kind: OperationalListKind,
  scope: string,
): OperationalListCacheEntry<T> | undefined {
  const memory = memoryLists[kind].get(scope) as OperationalListCacheEntry<T> | undefined;
  if (memory) return memory;
  const session = readListSession<T>(kind, scope);
  if (session) {
    memoryLists[kind].set(scope, session);
    syncItemMapFromList(kind, scope, session.items, LIST_ID_GETTERS[kind]);
    return session;
  }
  return undefined;
}

function writeListCache<T extends VersionedRecord>(
  kind: OperationalListKind,
  scope: string,
  items: T[],
  getId: (item: T) => string,
): OperationalListCacheEntry<T> {
  const entry: OperationalListCacheEntry<T> = {
    items,
    fingerprint: listFingerprint(items, getId),
    version: maxUpdatedAt(items),
    fetchedAt: Date.now(),
  };
  memoryLists[kind].set(scope, entry);
  writeListSession(kind, scope, entry);
  syncItemMapFromList(kind, scope, items, getId);
  return entry;
}

function syncItemMapFromList<T extends VersionedRecord>(
  kind: OperationalListKind,
  scope: string,
  items: T[],
  getId: (item: T) => string,
) {
  const map = new Map<string, VersionedRecord>();
  for (const item of items) {
    map.set(getId(item), item);
  }
  memoryItems[kind].set(scope, map);
}

function inflightKey(kind: OperationalListKind, scope: string) {
  return `${kind}:${scope}`;
}

async function fetchListDeduped<T>(
  kind: OperationalListKind,
  scope: string,
  fetcher: () => Promise<T>,
): Promise<T> {
  const key = inflightKey(kind, scope);
  const pending = inflightLists.get(key);
  if (pending) return pending as Promise<T>;

  const promise = fetcher();
  inflightLists.set(key, promise);
  void promise.finally(() => {
    if (inflightLists.get(key) === promise) inflightLists.delete(key);
  });
  return promise;
}

export async function fetchOperationalListCached<T extends VersionedRecord>(options: {
  kind: OperationalListKind;
  scope?: string;
  force?: boolean;
  getId: (item: T) => string;
  fetchRemote: () => Promise<T[]>;
}): Promise<T[]> {
  const scope = options.scope ?? getOperationalCacheScope();
  const cached = readListCache<T>(options.kind, scope);

  if (cached && !options.force && isCacheFresh(cached)) {
    return cached.items;
  }

  const remote = await fetchListDeduped(options.kind, scope, options.fetchRemote);
  const remoteFp = listFingerprint(remote, options.getId);

  if (cached && options.force && cached.fingerprint === remoteFp) {
    // Refresh TTL even when data unchanged
    const refreshed = writeListCache(options.kind, scope, cached.items, options.getId);
    return refreshed.items;
  }

  const entry = writeListCache(options.kind, scope, remote, options.getId);
  return entry.items;
}

/** O(1) length peek from memory/session cache without allocating a new array. */
export function peekOperationalListLength(
  kind: OperationalListKind,
  scope?: string,
): number | null {
  const cached = readListCache(kind, scope ?? getOperationalCacheScope());
  return cached ? cached.items.length : null;
}

export function readOperationalItemFromListCache<T extends VersionedRecord>(
  kind: OperationalListKind,
  scope: string,
  id: string,
  getId: (item: T) => string,
): T | undefined {
  const fromMap = memoryItems[kind].get(scope)?.get(id) as T | undefined;
  if (fromMap) return fromMap;
  const list = readListCache<T>(kind, scope);
  return list?.items.find((item) => getId(item) === id);
}

export function removeOperationalListItem(
  kind: OperationalListKind,
  scope: string,
  id: string,
  getId: (row: VersionedRecord) => string,
) {
  memoryItems[kind].get(scope)?.delete(id);
  const cached = readListCache(kind, scope);
  if (!cached) return;
  const items = cached.items.filter((row) => getId(row) !== id);
  writeListCache(kind, scope, items, getId);
}

export function upsertOperationalListItem<T extends VersionedRecord>(
  kind: OperationalListKind,
  scope: string,
  item: T,
  getId: (row: T) => string,
) {
  const id = getId(item);
  const itemMaps = memoryItems[kind];
  let itemMap = itemMaps.get(scope);
  if (!itemMap) {
    itemMap = new Map();
    itemMaps.set(scope, itemMap);
  }
  itemMap.set(id, item);

  const cached = readListCache<T>(kind, scope);
  const items = cached ? [...cached.items] : [];
  const index = items.findIndex((row) => getId(row) === id);
  if (index >= 0) items[index] = item;
  else items.push(item);
  writeListCache(kind, scope, items, getId);
}

export function clearOperationalDataCache(scope?: string) {
  const clearScope = (target: string) => {
    for (const kind of ALL_KINDS) {
      memoryLists[kind].delete(target);
      memoryItems[kind].delete(target);
    }
    if (!canUseSessionStorage()) return;
    try {
      for (const kind of ALL_KINDS) {
        sessionStorage.removeItem(listStorageKey(kind, target));
      }
    } catch {
      // ignore
    }
  };

  if (scope) {
    clearScope(scope);
    for (const key of inflightLists.keys()) {
      if (key.endsWith(`:${scope}`)) inflightLists.delete(key);
    }
    return;
  }

  for (const kind of ALL_KINDS) {
    memoryLists[kind].clear();
    memoryItems[kind].clear();
  }
  inflightLists.clear();

  if (!canUseSessionStorage()) return;
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i -= 1) {
      const key = sessionStorage.key(i);
      if (key && ALL_KINDS.some((kind) => key.startsWith(STORAGE_PREFIX[kind]))) {
        sessionStorage.removeItem(key);
      }
    }
  } catch {
    // ignore
  }
}
