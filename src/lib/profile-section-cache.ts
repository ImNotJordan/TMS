import type { SectionKey } from "@/lib/profile-store";

export type ProfileSectionCacheEntry = {
  /** Raw payload from DynamoDB (merged with per-hook defaults on read). */
  server: Record<string, unknown> | null;
  updatedAt: string;
};

type ProfileSectionsSnapshot = Partial<Record<SectionKey, ProfileSectionCacheEntry>>;

const memoryByUser = new Map<string, ProfileSectionsSnapshot>();
const inflightByUser = new Map<string, Promise<ProfileSectionsSnapshot>>();
const inflightBySection = new Map<
  string,
  Promise<{ server: Record<string, unknown> | null; updatedAt: string | null }>
>();

const STORAGE_PREFIX = "titan-freight:profile-sections:";

function canUseSessionStorage() {
  return typeof window !== "undefined" && typeof sessionStorage !== "undefined";
}

function storageKey(userId: string) {
  return `${STORAGE_PREFIX}${userId}`;
}

function readSession(userId: string): ProfileSectionsSnapshot | null {
  if (!canUseSessionStorage()) return null;
  try {
    const raw = sessionStorage.getItem(storageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ProfileSectionsSnapshot;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writeSession(userId: string, snapshot: ProfileSectionsSnapshot) {
  if (!canUseSessionStorage()) return;
  try {
    sessionStorage.setItem(storageKey(userId), JSON.stringify(snapshot));
  } catch {
    // ignore quota errors
  }
}

function getUserSnapshot(userId: string): ProfileSectionsSnapshot {
  let snapshot = memoryByUser.get(userId);
  if (!snapshot) {
    snapshot = readSession(userId) ?? {};
    memoryByUser.set(userId, snapshot);
  }
  return snapshot;
}

export function mergeProfileDefaults<T extends Record<string, unknown>>(
  defaults: T,
  server: Record<string, unknown> | null | undefined,
): T {
  if (!server) return { ...defaults };
  return { ...defaults, ...server } as T;
}

export function readProfileSectionCache(
  userId: string,
  section: SectionKey,
): ProfileSectionCacheEntry | undefined {
  return getUserSnapshot(userId)[section];
}

export function writeProfileSectionCache(
  userId: string,
  section: SectionKey,
  server: Record<string, unknown> | null,
  updatedAt?: string,
): ProfileSectionCacheEntry {
  const snapshot = { ...getUserSnapshot(userId) };
  const entry: ProfileSectionCacheEntry = {
    server,
    updatedAt: updatedAt ?? new Date().toISOString(),
  };
  snapshot[section] = entry;
  memoryByUser.set(userId, snapshot);
  writeSession(userId, snapshot);
  return entry;
}

/** True when cached server timestamp is at least as new as the remote value. */
export function isProfileSectionCacheFresh(
  cached: ProfileSectionCacheEntry | undefined,
  remoteUpdatedAt: string | null | undefined,
): boolean {
  if (!cached) return false;
  if (!remoteUpdatedAt) return true;
  return cached.updatedAt >= remoteUpdatedAt;
}

export function clearProfileSectionCache(userId?: string) {
  if (!userId) {
    memoryByUser.clear();
    inflightByUser.clear();
    if (!canUseSessionStorage()) return;
    try {
      for (let i = sessionStorage.length - 1; i >= 0; i -= 1) {
        const key = sessionStorage.key(i);
        if (key?.startsWith(STORAGE_PREFIX)) sessionStorage.removeItem(key);
      }
    } catch {
      // ignore
    }
    return;
  }
  memoryByUser.delete(userId);
  inflightByUser.delete(userId);
  clearProfileSectionInflight(userId);
  if (canUseSessionStorage()) {
    try {
      sessionStorage.removeItem(storageKey(userId));
    } catch {
      // ignore
    }
  }
}

export function getProfileSectionInflight(userId: string) {
  return inflightByUser.get(userId);
}

export function setProfileSectionInflight(userId: string, promise: Promise<ProfileSectionsSnapshot>) {
  inflightByUser.set(userId, promise);
}

export function clearProfileSectionInflight(userId: string) {
  inflightByUser.delete(userId);
  for (const key of inflightBySection.keys()) {
    if (key.startsWith(`${userId}:`)) inflightBySection.delete(key);
  }
}

function sectionRequestKey(userId: string, section: SectionKey) {
  return `${userId}:${section}`;
}

/** Deduplicate concurrent DynamoDB reads for the same user + section. */
export function fetchProfileSectionDeduped<T extends Record<string, unknown>>(
  userId: string,
  section: SectionKey,
  fetcher: () => Promise<{ data: Partial<T> | null; updatedAt: string | null }>,
): Promise<{ server: Record<string, unknown> | null; updatedAt: string | null }> {
  const key = sectionRequestKey(userId, section);
  const pending = inflightBySection.get(key);
  if (pending) return pending;

  const promise = fetcher().then((result) => ({
    server: (result.data ?? null) as Record<string, unknown> | null,
    updatedAt: result.updatedAt,
  }));

  inflightBySection.set(key, promise);
  void promise.finally(() => {
    if (inflightBySection.get(key) === promise) inflightBySection.delete(key);
  });
  return promise;
}

export async function hydrateProfileSectionCache(
  userId: string,
  loader: () => Promise<ProfileSectionsSnapshot>,
): Promise<ProfileSectionsSnapshot> {
  const existing = memoryByUser.get(userId);
  if (existing && Object.keys(existing).length > 0) {
    return existing;
  }

  const session = readSession(userId);
  if (session && Object.keys(session).length > 0) {
    memoryByUser.set(userId, session);
    return session;
  }

  const pending = inflightByUser.get(userId);
  if (pending) return pending;

  const promise = loader().then((snapshot) => {
    memoryByUser.set(userId, snapshot);
    writeSession(userId, snapshot);
    return snapshot;
  });

  inflightByUser.set(userId, promise);
  try {
    return await promise;
  } finally {
    inflightByUser.delete(userId);
  }
}
