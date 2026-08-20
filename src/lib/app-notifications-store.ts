import type { DriverStatusHistoryEntry, LoadRecord } from "@/lib/loads-store";
import { listAllLoadsCached } from "@/lib/loads-store";
import { syncTrackingSessionsForLoads } from "@/lib/tracking-workflow-store";

export type AppNotificationType = "load" | "quote" | "carrier" | "alert" | "payment" | "system";

export type AppNotificationItem = {
  id: string;
  type: AppNotificationType;
  title: string;
  description: string;
  /** Absolute ISO time for sorting / relative labels. */
  createdAt: string;
  read: boolean;
  href?: string;
  loadId?: string;
  source: "driver";
};

const READ_KEY = "titan.app-notifications.read-ids";
const SEEN_EVENTS_KEY = "titan.app-notifications.seen-events";
const LIVE_KEY = "titan.app-notifications.live";

const WORKFLOW_LABELS: Record<string, string> = {
  assigned: "Assigned / accepted",
  "en-route-pickup": "En route to pickup",
  "at-pickup": "Arrived at pickup",
  loaded: "Loaded",
  "en-route-delivery": "En route to delivery",
  "at-delivery": "Arrived at delivery",
  delivered: "Delivered",
};

type Listener = () => void;

let liveItems: AppNotificationItem[] = readLiveItems();
const readIds = readStringSet(READ_KEY);
const seenEvents = readStringSet(SEEN_EVENTS_KEY);
let seeded = seenEvents.size > 0;
const listeners = new Set<Listener>();

function readStringSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as string[];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function writeStringSet(key: string, set: Set<string>) {
  try {
    localStorage.setItem(key, JSON.stringify([...set]));
  } catch {
    /* ignore quota */
  }
}

function readLiveItems(): AppNotificationItem[] {
  try {
    const raw = localStorage.getItem(LIVE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AppNotificationItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLiveItems(items: AppNotificationItem[]) {
  try {
    // Cap persistence so localStorage stays healthy
    localStorage.setItem(LIVE_KEY, JSON.stringify(items.slice(0, 80)));
  } catch {
    /* ignore */
  }
}

function emit() {
  for (const listener of listeners) listener();
}

export function subscribeAppNotifications(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function formatNotificationTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function workflowLabel(status: string) {
  return WORKFLOW_LABELS[status] ?? status.replace(/-/g, " ");
}

function routeLine(load: LoadRecord) {
  const from = [load.pickupCity, load.pickupState].filter(Boolean).join(", ");
  const to = [load.deliveryCity, load.deliveryState].filter(Boolean).join(", ");
  if (from && to) return `${from} → ${to}`;
  return from || to || "Route pending";
}

function applyReadState(item: AppNotificationItem): AppNotificationItem {
  return { ...item, read: item.read || readIds.has(item.id) };
}

export function getAppNotifications(): AppNotificationItem[] {
  return liveItems
    .map(applyReadState)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function markAppNotificationRead(id: string) {
  readIds.add(id);
  writeStringSet(READ_KEY, readIds);
  liveItems = liveItems.map((n) => (n.id === id ? { ...n, read: true } : n));
  writeLiveItems(liveItems);
  emit();
}

export function markAllAppNotificationsRead() {
  for (const n of getAppNotifications()) readIds.add(n.id);
  writeStringSet(READ_KEY, readIds);
  liveItems = liveItems.map((n) => ({ ...n, read: true }));
  writeLiveItems(liveItems);
  emit();
}

function prependLive(items: AppNotificationItem[]) {
  if (items.length === 0) return;
  const existing = new Set(liveItems.map((n) => n.id));
  const fresh = items.filter((n) => !existing.has(n.id));
  if (fresh.length === 0) return;
  liveItems = [...fresh, ...liveItems].slice(0, 80);
  writeLiveItems(liveItems);
  emit();
}

function eventIdForStatus(loadId: string, entry: DriverStatusHistoryEntry) {
  return `driver-status:${loadId}:${entry.at}:${entry.status}`;
}

function eventIdForDoc(loadId: string, tag: string) {
  return `driver-doc:${loadId}:${tag}`;
}

function notificationFromStatus(
  load: LoadRecord,
  entry: DriverStatusHistoryEntry,
): AppNotificationItem {
  const label = workflowLabel(entry.status);
  const driver = entry.byName?.trim() || "Driver";
  const route = routeLine(load);
  const isDelivered = entry.status === "delivered";
  return {
    id: eventIdForStatus(load.loadId, entry),
    type: isDelivered
      ? "load"
      : entry.status.includes("route") || entry.status.startsWith("at-")
        ? "alert"
        : "load",
    title: isDelivered ? `${load.loadId} delivered` : `${load.loadId} · ${label}`,
    description: `${driver} marked status as ${label} on ${route}.`,
    createdAt: entry.at,
    read: false,
    href: `/tracking?loadId=${encodeURIComponent(load.loadId)}&tab=messages`,
    loadId: load.loadId,
    source: "driver",
  };
}

function notificationFromDoc(load: LoadRecord, tag: string, at: string): AppNotificationItem {
  const isPod = tag.startsWith("pod:");
  const fileName = tag.slice(tag.indexOf(":") + 1) || "document";
  const kind = isPod ? "Proof of delivery" : "Bill of lading";
  return {
    id: eventIdForDoc(load.loadId, tag),
    type: "load",
    title: isPod ? `POD uploaded for ${load.loadId}` : `BOL uploaded for ${load.loadId}`,
    description: `Driver uploaded ${kind} (${fileName}). ${routeLine(load)}.`,
    createdAt: at,
    read: false,
    href: `/tracking?loadId=${encodeURIComponent(load.loadId)}&tab=documents`,
    loadId: load.loadId,
    source: "driver",
  };
}

/**
 * Diff loads against last-seen driver events. First successful pass seeds silently.
 * Returns newly created notification items (for toasts).
 */
export function ingestDriverEventsFromLoads(loads: LoadRecord[]): AppNotificationItem[] {
  const eventIds: string[] = [];
  const candidates: AppNotificationItem[] = [];

  for (const load of loads) {
    const history = load.driverStatusHistory ?? [];
    for (const entry of history) {
      if (!entry?.status || !entry?.at) continue;
      const id = eventIdForStatus(load.loadId, entry);
      eventIds.push(id);
      if (!seenEvents.has(id)) {
        candidates.push(notificationFromStatus(load, entry));
      }
    }

    // Seed-only fallback for loads that predate driverStatusHistory
    if (history.length === 0 && load.driverWorkflowStatus && load.updatedAt) {
      const synthetic: DriverStatusHistoryEntry = {
        status: load.driverWorkflowStatus,
        at: load.updatedAt,
        by: load.assignedDriver,
      };
      eventIds.push(eventIdForStatus(load.loadId, synthetic));
    }

    for (const tag of load.documents ?? []) {
      if (!tag.startsWith("bol:") && !tag.startsWith("pod:")) continue;
      const id = eventIdForDoc(load.loadId, tag);
      eventIds.push(id);
      if (!seenEvents.has(id)) {
        candidates.push(notificationFromDoc(load, tag, load.updatedAt || new Date().toISOString()));
      }
    }
  }

  if (!seeded) {
    for (const id of eventIds) seenEvents.add(id);
    writeStringSet(SEEN_EVENTS_KEY, seenEvents);
    seeded = true;
    return [];
  }

  const fresh = candidates
    .filter((n) => !seenEvents.has(n.id))
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  for (const n of fresh) seenEvents.add(n.id);
  if (fresh.length > 0) writeStringSet(SEEN_EVENTS_KEY, seenEvents);

  prependLive(fresh.slice().reverse());
  return fresh;
}

export async function pollDriverStatusNotifications(): Promise<AppNotificationItem[]> {
  try {
    const loads = await listAllLoadsCached({ force: true });
    // Keep Tracking documents/status in sync when drivers upload from the portal
    syncTrackingSessionsForLoads(loads, "Dispatcher");
    return ingestDriverEventsFromLoads(loads);
  } catch (err) {
    console.warn("[notifications] poll failed", err);
    return [];
  }
}
