import type { Load } from "@/lib/mock-data";

const SEEN_KEY = "driver-portal.seen-assignment-ids";
const PUSH_PREF_KEY = "driver-portal.push-notifications";
const UNREAD_KEY = "driver-portal.unread-assignments";

function seenKey(userId: string) {
  return `${SEEN_KEY}:${userId}`;
}
function pushKey(userId: string) {
  return `${PUSH_PREF_KEY}:${userId}`;
}
function unreadKey(userId: string) {
  return `${UNREAD_KEY}:${userId}`;
}

export function readSeenAssignmentIds(userId: string): Set<string> {
  try {
    const raw = localStorage.getItem(seenKey(userId));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as string[];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

export function writeSeenAssignmentIds(userId: string, ids: Set<string>) {
  try {
    localStorage.setItem(seenKey(userId), JSON.stringify([...ids]));
  } catch {
    /* ignore quota */
  }
}

export function markAssignmentsSeen(userId: string, loadIds: string[]) {
  const seen = readSeenAssignmentIds(userId);
  for (const id of loadIds) seen.add(id);
  writeSeenAssignmentIds(userId, seen);
  clearUnreadAssignmentIds(userId, loadIds);
}

export function readPushPreference(userId: string): boolean {
  try {
    const raw = localStorage.getItem(pushKey(userId));
    if (raw == null) return true; // opt-in by default; permission still required for OS push
    return raw === "1" || raw === "true";
  } catch {
    return true;
  }
}

export function writePushPreference(userId: string, enabled: boolean) {
  try {
    localStorage.setItem(pushKey(userId), enabled ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function readUnreadAssignmentIds(userId: string): string[] {
  try {
    const raw = localStorage.getItem(unreadKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function addUnreadAssignmentIds(userId: string, loadIds: string[]) {
  const set = new Set(readUnreadAssignmentIds(userId));
  for (const id of loadIds) set.add(id);
  try {
    localStorage.setItem(unreadKey(userId), JSON.stringify([...set]));
  } catch {
    /* ignore */
  }
  dispatchUnreadChange();
}

export function clearUnreadAssignmentIds(userId: string, loadIds?: string[]) {
  if (!loadIds) {
    try {
      localStorage.removeItem(unreadKey(userId));
    } catch {
      /* ignore */
    }
    dispatchUnreadChange();
    return;
  }
  const set = new Set(readUnreadAssignmentIds(userId));
  for (const id of loadIds) set.delete(id);
  try {
    localStorage.setItem(unreadKey(userId), JSON.stringify([...set]));
  } catch {
    /* ignore */
  }
  dispatchUnreadChange();
}

const UNREAD_EVENT = "driver-portal:unread-assignments";

function dispatchUnreadChange() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(UNREAD_EVENT));
  }
}

export function subscribeUnreadAssignments(listener: () => void) {
  window.addEventListener(UNREAD_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(UNREAD_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

/** Loads that should alert the driver when newly appearing. */
export function notifiableLoads(loads: Load[]): Load[] {
  return loads.filter((l) => l.status === "offered" || l.status === "assigned");
}

export function formatLoadRoute(load: Load): string {
  return `${load.pickup.city}, ${load.pickup.state} → ${load.delivery.city}, ${load.delivery.state}`;
}

export function formatLoadRate(load: Load): string {
  return `$${load.rate.toLocaleString()}`;
}

export type PushPermissionState = NotificationPermission | "unsupported";

export function getPushPermissionState(): PushPermissionState {
  if (typeof window === "undefined" || typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

export async function requestPushPermission(): Promise<PushPermissionState> {
  if (typeof window === "undefined" || typeof Notification === "undefined") return "unsupported";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  try {
    const result = await Notification.requestPermission();
    return result;
  } catch {
    return Notification.permission;
  }
}

export function showBrowserLoadNotification(load: Load, kind: "offer" | "assigned") {
  if (typeof window === "undefined" || typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;

  const title = kind === "offer" ? "New load offer" : "Load assigned to you";
  const body = `${formatLoadRoute(load)} · ${formatLoadRate(load)} · ${load.distanceMiles} mi`;

  try {
    const notification = new Notification(title, {
      body,
      tag: `titan-load-${load.id}`,
      // Prefer app icon when available
      icon: "/logo.png",
      badge: "/logo.png",
      data: { loadId: load.id, kind },
    });
    notification.onclick = () => {
      try {
        window.focus();
      } catch {
        /* ignore */
      }
      // Soft navigation via hash event — watcher listens and routes
      window.dispatchEvent(
        new CustomEvent("driver-portal:open-load", { detail: { loadId: load.id } }),
      );
      notification.close();
    };
  } catch {
    /* some browsers throw if not triggered by gesture — ignore */
  }
}
