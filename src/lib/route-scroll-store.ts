/**
 * Persist window + nested-region scroll positions per route pathname.
 * Keyed by pathname (not history entry) so sidebar re-visits restore the last place.
 */

const STORAGE_KEY = "titan.route-scroll.v1";

type RouteScrollEntry = {
  windowY: number;
  regions: Record<string, number>;
};

type RouteScrollStore = Record<string, RouteScrollEntry>;

function canUseSessionStorage() {
  try {
    return typeof sessionStorage !== "undefined";
  } catch {
    return false;
  }
}

function readStore(): RouteScrollStore {
  if (!canUseSessionStorage()) return {};
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as RouteScrollStore;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(store: RouteScrollStore) {
  if (!canUseSessionStorage()) return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* quota / private mode */
  }
}

export function routeScrollKey(pathname: string) {
  const path = pathname.trim() || "/";
  return path.startsWith("/") ? path : `/${path}`;
}

function entryFor(store: RouteScrollStore, key: string): RouteScrollEntry {
  return store[key] ?? { windowY: 0, regions: {} };
}

export function saveWindowScrollY(key: string, y: number) {
  const store = readStore();
  const entry = entryFor(store, key);
  const nextY = Math.max(0, Math.round(y));
  if (entry.windowY === nextY) return;
  store[key] = { ...entry, windowY: nextY };
  writeStore(store);
}

export function getWindowScrollY(key: string): number {
  return entryFor(readStore(), key).windowY || 0;
}

export function saveRegionScrollY(key: string, regionId: string, y: number) {
  const id = regionId.trim();
  if (!id) return;
  const store = readStore();
  const entry = entryFor(store, key);
  const nextY = Math.max(0, Math.round(y));
  if (entry.regions[id] === nextY) return;
  store[key] = {
    ...entry,
    regions: { ...entry.regions, [id]: nextY },
  };
  writeStore(store);
}

export function getRegionScrollY(key: string, regionId: string): number | undefined {
  const id = regionId.trim();
  if (!id) return undefined;
  const value = entryFor(readStore(), key).regions[id];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
