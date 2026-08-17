import { isDynamoResourceNotFound } from "../dynamodb";

/**
 * Message persistence is always available now.
 *
 * This used to read `VITE_TRACKING_MESSAGES_TABLE_NAME` to decide whether the
 * browser could reach the table. Messages go through `/api/tracking-messages`
 * today, so the table name is a server concern and that variable no longer has
 * to exist in the browser build — but the gates below still read well as
 * "should we persist?", so they stay and this answers yes.
 */
const isTrackingMessagesConfigured = () => true;
import { isDriverGpsFresh } from "../driver-gps";
import { checkLoadTransition, normalizeLoadStatus, type LoadStatus } from "../load-status";
import { latestDriverStatus, type LoadRecord } from "../loads-store";
import { trackingDocumentsFromLoad } from "../load-documents";
import {
  createTrackingMessageId,
  deleteTrackingMessageRecord,
  listTrackingMessages,
  putTrackingMessage,
} from "../tracking-messages-store";

import type {
  DriverWorkflowAction,
  TimelineSource,
  TrackingAlert,
  TrackingDocument,
  TrackingLocation,
  TrackingMessage,
  TrackingSession,
  TrackingSessionCloud,
  TrackingState,
  TrackingTimelineEvent,
} from "./types";
import { DRIVER_ACTION_LABELS, TRACKING_STATE_LABELS } from "./types";

export type {
  DriverWorkflowAction,
  TimelineSource,
  TrackingAlert,
  TrackingDocument,
  TrackingLocation,
  TrackingMessage,
  TrackingSession,
  TrackingSessionCloud,
  TrackingState,
  TrackingTimelineEvent,
};
export { DRIVER_ACTION_LABELS, TRACKING_STATE_LABELS };

type TrackingListener = () => void;

const DRIVER_NAME_BY_ID: Record<string, string> = {
  "d-101": "Dwayne Carter",
  "d-102": "Marisa Lopez",
  "d-201": "Sam Reyes",
  "d-301": "Tyrese Hill",
};

const STORAGE_KEY = "ls_tracking_sessions_v1";
const TICK_MS = 15_000;
const PERSIST_DEBOUNCE_MS = 2_000;
const CLOUD_PERSIST_DEBOUNCE_MS = 8_000;
const MOVABLE_STATES: TrackingState[] = [
  "en-route-pickup",
  "in-transit",
  "at-pickup",
  "at-delivery",
  "driver-accepted",
];

const listeners = new Set<TrackingListener>();
let sessionsByLoadId: Record<string, TrackingSession> = {};
let bootstrapped = false;
let tickerHandle: ReturnType<typeof setInterval> | null = null;
let visibilityBound = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persistDirty = false;
let snapshotSourceRef: Record<string, TrackingSession> | null = null;
let snapshotCache: TrackingSession[] = [];
let countSourceRef: Record<string, TrackingSession> | null = null;
let countSnapshot = 0;
const cloudPersistTimers = new Map<string, ReturnType<typeof setTimeout>>();
const cloudPersistInFlight = new Set<string>();

export function toTrackingSessionCloud(session: TrackingSession): TrackingSessionCloud {
  const { messages: _messages, documents, ...rest } = session;
  return {
    ...rest,
    documentMeta: documents.map(({ viewUrl: _viewUrl, ...meta }) => meta),
  };
}

function mergeCloudIntoSession(
  cloud: TrackingSessionCloud,
  base: TrackingSession,
): TrackingSession {
  const { documentMeta, ...rest } = cloud;
  return {
    ...base,
    ...rest,
    messages: base.messages,
    documents: base.documents.length ? base.documents : (documentMeta ?? []).map((d) => ({ ...d })),
  };
}

function canUseBrowserStorage() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function bootIfNeeded() {
  if (bootstrapped) return;
  bootstrapped = true;
  if (!canUseBrowserStorage()) return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, TrackingSession>;
    if (parsed && typeof parsed === "object") {
      sessionsByLoadId = parsed;
    }
  } catch {
    sessionsByLoadId = {};
  }
}

function persist() {
  if (!canUseBrowserStorage()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionsByLoadId));
    persistDirty = false;
  } catch {
    // ignore storage errors
  }
}

function schedulePersist() {
  persistDirty = true;
  if (persistTimer || typeof window === "undefined") return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    if (persistDirty) persist();
  }, PERSIST_DEBOUNCE_MS);
}

function flushPersist() {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  if (persistDirty) persist();
}

async function writeSessionToLoad(loadId: string, propagateDriverStatus = false) {
  const session = sessionsByLoadId[loadId];
  if (!session || cloudPersistInFlight.has(loadId)) return;
  cloudPersistInFlight.add(loadId);
  try {
    const { getLoadById, patchLoad } = await import("../loads-store");
    const load = await getLoadById(loadId);
    if (!load) return;
    const cloud = toTrackingSessionCloud(session);
    // Skip no-op writes when cloud already matches
    if (
      load.trackingSession?.updatedAt === cloud.updatedAt &&
      load.trackingSession?.trackingState === cloud.trackingState &&
      load.trackingSession?.routeProgressPct === cloud.routeProgressPct
    ) {
      return;
    }

    // `driverWorkflowStatus` belongs to the driver portal. A background write-through
    // (poll, ticker, session rebuild) must never touch it — GetItem is eventually
    // consistent, so `load` can easily predate the driver's latest tap. Only an explicit
    // dispatcher action on the Driver Actions row is allowed to speak for the driver.
    const driverWorkflowStatus = propagateDriverStatus
      ? driverWorkflowForCloudWrite(cloud.trackingState, load.driverWorkflowStatus)
      : undefined;

    // `loadStatus` follows the same rule: only an explicit dispatcher action may
    // move it, and only forwards along the lifecycle table. Without this a load
    // delivered on the tracking board never reached the billing queue.
    const loadStatus = propagateDriverStatus
      ? loadStatusForCloudWrite(cloud.trackingState, load.loadStatus)
      : undefined;

    await patchLoad(loadId, { trackingSession: cloud, driverWorkflowStatus, loadStatus });
  } catch (err) {
    console.warn("[tracking] cloud persist failed", loadId, err);
  } finally {
    cloudPersistInFlight.delete(loadId);
  }
}

/** Persist session onto the Loads Dynamo item (write-through). */
export function scheduleCloudPersist(
  loadId: string,
  mode: "immediate" | "debounce" = "immediate",
  opts?: { propagateDriverStatus?: boolean },
) {
  if (typeof window === "undefined") return;
  const propagate = opts?.propagateDriverStatus ?? false;
  const existing = cloudPersistTimers.get(loadId);
  if (existing) {
    clearTimeout(existing);
    cloudPersistTimers.delete(loadId);
  }
  if (mode === "immediate") {
    void writeSessionToLoad(loadId, propagate);
    return;
  }
  const timer = setTimeout(() => {
    cloudPersistTimers.delete(loadId);
    void writeSessionToLoad(loadId, propagate);
  }, CLOUD_PERSIST_DEBOUNCE_MS);
  cloudPersistTimers.set(loadId, timer);
}

type EmitMode = "immediate" | "debounce" | "skip";

function emit(persistMode: EmitMode = "immediate", cloudLoadId?: string) {
  snapshotSourceRef = null;
  countSourceRef = null;
  if (persistMode === "immediate") persist();
  else if (persistMode === "debounce") schedulePersist();
  if (cloudLoadId) {
    scheduleCloudPersist(cloudLoadId, persistMode === "debounce" ? "debounce" : "immediate");
  }
  for (const listener of listeners) listener();
}

function hasMovableSessions() {
  for (const session of Object.values(sessionsByLoadId)) {
    if (session.isActive && MOVABLE_STATES.includes(session.trackingState)) return true;
  }
  return false;
}

function stopTicker() {
  if (!tickerHandle) return;
  clearInterval(tickerHandle);
  tickerHandle = null;
}

function bindVisibilityPause() {
  if (visibilityBound || typeof document === "undefined") return;
  visibilityBound = true;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopTicker();
      flushPersist();
      return;
    }
    ensureTicker();
  });
  window.addEventListener("pagehide", flushPersist);
}

function ensureTicker() {
  if (typeof window === "undefined") return;
  bindVisibilityPause();

  if (listeners.size === 0 || !hasMovableSessions() || document.hidden) {
    stopTicker();
    return;
  }
  if (tickerHandle) return;

  tickerHandle = setInterval(() => {
    if (document.hidden || listeners.size === 0) {
      stopTicker();
      return;
    }

    const next: Record<string, TrackingSession> = { ...sessionsByLoadId };
    let changed = false;
    const now = Date.now();

    for (const [loadId, session] of Object.entries(next)) {
      if (!session.isActive) continue;
      if (!MOVABLE_STATES.includes(session.trackingState)) continue;

      // Keep live driver GPS — don't overwrite with simulated route progress.
      if (
        session.gps.source === "driver" &&
        isDriverGpsFresh({
          lat: session.gps.location.lat,
          lng: session.gps.location.lng,
          lastPingAt: session.gps.lastPingAt,
        })
      ) {
        continue;
      }

      let progress = session.routeProgressPct;
      if (session.trackingState === "en-route-pickup") progress = Math.min(24, progress + 2);
      else if (session.trackingState === "in-transit") progress = Math.min(92, progress + 1.3);
      else if (session.trackingState === "at-pickup") progress = Math.min(35, progress + 0.3);
      else if (session.trackingState === "at-delivery") progress = Math.min(96, progress + 0.2);
      else progress = Math.min(12, progress + 0.6);

      const pickupCoord = inferLocationFromLoad(
        {
          loadId,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          pickupCity: session.pickup.city,
          pickupState: session.pickup.state,
          deliveryCity: session.delivery.city,
          deliveryState: session.delivery.state,
        } as LoadRecord,
        "pickup",
      );
      const deliveryCoord = inferLocationFromLoad(
        {
          loadId,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          pickupCity: session.pickup.city,
          pickupState: session.pickup.state,
          deliveryCity: session.delivery.city,
          deliveryState: session.delivery.state,
        } as LoadRecord,
        "delivery",
      );

      const milesRemaining = Math.max(0, Math.round((1 - progress / 100) * session.milesTotal));
      const speedMph = Math.round(56 + ((now / 1000 + loadId.length) % 10));
      const etaHours = milesRemaining / Math.max(1, speedMph);
      const eta = new Date(now + etaHours * 60 * 60 * 1000).toISOString();

      next[loadId] = {
        ...session,
        routeProgressPct: progress,
        milesRemaining,
        eta,
        gps: {
          location: interpolateLocation(pickupCoord, deliveryCoord, progress),
          speedMph,
          headingDeg: Math.round(90 + ((now / 1000) % 180)),
          lastPingAt: nowIso(),
          source: "simulated",
        },
        updatedAt: nowIso(),
      };
      changed = true;

      const updated = next[loadId];
      if (
        updated.trackingState === "en-route-pickup" &&
        progress >= 20 &&
        !updated.geofence.pickupArrivedAt
      ) {
        sessionsByLoadId = next;
        applyDriverAction(loadId, "arrived-pickup", {
          user: updated.assignedDriverName,
          source: "geofence",
          notes: "Auto-detected pickup geofence arrival.",
        });
        return;
      }

      if (
        updated.trackingState === "in-transit" &&
        progress >= 90 &&
        !updated.geofence.deliveryArrivedAt
      ) {
        sessionsByLoadId = next;
        applyDriverAction(loadId, "arrived-delivery", {
          user: updated.assignedDriverName,
          source: "geofence",
          notes: "Auto-detected delivery geofence arrival.",
        });
        return;
      }
    }

    if (changed) {
      sessionsByLoadId = next;
      // GPS ticks: debounce local + Dynamo writes
      emit("debounce");
      for (const id of Object.keys(next)) {
        if (MOVABLE_STATES.includes(next[id]!.trackingState)) {
          scheduleCloudPersist(id, "debounce");
        }
      }
    }

    if (!hasMovableSessions()) stopTicker();
  }, TICK_MS);
}

export function subscribeTrackingSessions(listener: TrackingListener): () => void {
  bootIfNeeded();
  listeners.add(listener);
  ensureTicker();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stopTicker();
      flushPersist();
    }
  };
}

export function getTrackingSessionsSnapshot(): TrackingSession[] {
  bootIfNeeded();
  if (snapshotSourceRef === sessionsByLoadId) return snapshotCache;
  snapshotCache = Object.values(sessionsByLoadId).sort((a, b) =>
    (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""),
  );
  snapshotSourceRef = sessionsByLoadId;
  return snapshotCache;
}

/** Count-only snapshot so chrome (sidebar badges) can skip rebuilding session arrays. */
export function getTrackingSessionCountSnapshot(): number {
  bootIfNeeded();
  if (countSourceRef === sessionsByLoadId) return countSnapshot;
  countSnapshot = Object.keys(sessionsByLoadId).length;
  countSourceRef = sessionsByLoadId;
  return countSnapshot;
}

function nowIso() {
  return new Date().toISOString();
}

function numberFromSeed(seed: string, min: number, max: number) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  const ratio = Math.abs(hash % 10_000) / 10_000;
  return min + (max - min) * ratio;
}

function estimateMiles(pickup: TrackingLocation, delivery: TrackingLocation) {
  const lat = Math.abs(delivery.lat - pickup.lat);
  const lng = Math.abs(delivery.lng - pickup.lng);
  const rough = Math.sqrt(lat * lat + lng * lng) * 69;
  return Math.max(120, Math.round(rough));
}

function interpolateLocation(
  pickup: TrackingLocation,
  delivery: TrackingLocation,
  progressPct: number,
): TrackingLocation {
  const t = Math.min(1, Math.max(0, progressPct / 100));
  return {
    lat: pickup.lat + (delivery.lat - pickup.lat) * t,
    lng: pickup.lng + (delivery.lng - pickup.lng) * t,
    city: t >= 0.95 ? delivery.city : t <= 0.05 ? pickup.city : "In transit",
    state: t >= 0.95 ? delivery.state : t <= 0.05 ? pickup.state : undefined,
  };
}

function inferLocationFromLoad(load: LoadRecord, type: "pickup" | "delivery"): TrackingLocation {
  const city = type === "pickup" ? load.pickupCity : load.deliveryCity;
  const state = type === "pickup" ? load.pickupState : load.deliveryState;
  const seed = `${load.loadId}:${type}:${city ?? ""}:${state ?? ""}`;
  return {
    lat: numberFromSeed(seed, 26, 46),
    lng: numberFromSeed(seed + ":lng", -122, -73),
    city,
    state,
    label: [city, state].filter(Boolean).join(", "),
  };
}

function buildCustomerTrackingLink(loadId: string) {
  const token = Math.abs(Math.trunc(numberFromSeed(loadId, 1000, 9999)));
  return `https://track.logistics.app/t/${loadId}-${token}`;
}

function driverNameFromId(driverId: string) {
  return DRIVER_NAME_BY_ID[driverId] ?? driverId;
}

function makeTimelineEvent(
  session: TrackingSession,
  args: {
    action: TrackingTimelineEvent["action"];
    state: TrackingState;
    user: string;
    source: TimelineSource;
    notes?: string;
    location?: TrackingLocation;
  },
): TrackingTimelineEvent {
  return {
    id: `${session.loadId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    action: args.action,
    state: args.state,
    timestamp: nowIso(),
    location: args.location ?? session.gps.location,
    user: args.user,
    source: args.source,
    notes: args.notes,
  };
}

export function getDriverAssignedLoads(driverId: string): TrackingSession[] {
  return getTrackingSessionsSnapshot().filter(
    (s) => s.assignedDriverId === driverId && !["completed", "exception"].includes(s.trackingState),
  );
}

export function normalizeLoadForDriverAssignment<
  T extends { assignedDriver?: string; loadStatus?: string },
>(load: T): T {
  if (!load.assignedDriver) return load;
  if (["delivered", "completed"].includes(load.loadStatus ?? "")) return load;
  if (load.loadStatus === "driver-assigned") return load;
  return { ...load, loadStatus: "driver-assigned" };
}

/** Rank for comparing tracking states (higher = further along). */
const TRACKING_STATE_RANK: Record<TrackingState, number> = {
  "waiting-driver": 0,
  // Between "nobody on it" and "driver said yes". Fractional so the existing
  // ranks keep their values and no comparison elsewhere shifts meaning.
  "driver-assigned": 0.5,
  "driver-accepted": 1,
  "en-route-pickup": 2,
  "at-pickup": 3,
  "in-transit": 4,
  "at-delivery": 5,
  delivered: 6,
  "pod-uploaded": 7,
  completed: 8,
  exception: -1,
};

/**
 * Ops `loadStatus` values that imply the driver is already moving, used when the
 * driver app has not reported a `driverWorkflowStatus` yet. `driver-assigned`,
 * `active`, `booked` and `tendered` are deliberately absent — they describe what
 * dispatch did, not driver acceptance, and must stay on "waiting-driver".
 */
const TRACKING_STATE_BY_LOAD_STATUS: Record<string, TrackingState> = {
  "driver-accepted": "driver-accepted",
  dispatched: "en-route-pickup",
  "en-route-pickup": "en-route-pickup",
  en_route_pickup: "en-route-pickup",
  "at-pickup": "at-pickup",
  at_pickup: "at-pickup",
  loaded: "at-pickup",
  "in-transit": "in-transit",
  in_transit: "in-transit",
  "en-route-delivery": "in-transit",
  en_route_delivery: "in-transit",
  "at-delivery": "at-delivery",
  at_delivery: "at-delivery",
  "pod-uploaded": "pod-uploaded",
  exception: "exception",
};

/**
 * `driverWorkflowStatus` is written by both apps but PARSED by the driver portal against
 * its own `ActiveLoadStatus` vocabulary — not `TrackingState`. Stamping raw tracking
 * states into it ("driver-accepted", "in-transit", "waiting-driver") leaves the portal
 * unable to recognise the value, so it falls back to "assigned" and the driver watches
 * their progress revert. Translate before writing; states with no driver-side
 * equivalent write nothing at all.
 */
const DRIVER_WORKFLOW_BY_TRACKING_STATE: Partial<Record<TrackingState, string>> = {
  // "driver-assigned" is absent alongside "waiting-driver": it describes what
  // dispatch did, so it must never overwrite what the driver last reported.
  "driver-accepted": "assigned",
  "en-route-pickup": "en-route-pickup",
  "at-pickup": "at-pickup",
  "in-transit": "en-route-delivery",
  "at-delivery": "at-delivery",
  delivered: "delivered",
  "pod-uploaded": "pod-uploaded",
  completed: "completed",
  // "waiting-driver" and "exception" are intentionally absent: neither describes a step
  // the driver reported, so neither may overwrite what the driver last said.
};

/** Driver-portal step order, mirroring apps/driver-portal `STATUS_STEPS`. */
const DRIVER_WORKFLOW_ORDER = [
  "assigned",
  "en-route-pickup",
  "at-pickup",
  "loaded",
  "en-route-delivery",
  "at-delivery",
  "delivered",
  "pod-uploaded",
  "completed",
];

/**
 * The `driverWorkflowStatus` an ops write-through may safely set, or undefined to leave
 * the field untouched.
 */
/**
 * The ops `loadStatus` a tracking state implies, or undefined to leave it alone.
 *
 * `writeSessionToLoad` wrote only `trackingSession` and `driverWorkflowStatus`, so
 * a dispatcher walking a load to delivered on the tracking board left `loadStatus`
 * wherever it was. `isLoadBillable` reads `loadStatus` — a single `||` fallback on
 * `driverWorkflowStatus` was all that kept those loads in the billing queue.
 *
 * States describing dispatch's own act, or an exception, map to nothing: an
 * exception is not a lifecycle position and must not overwrite one.
 */
const LOAD_STATUS_BY_TRACKING_STATE: Partial<Record<TrackingState, LoadStatus>> = {
  "driver-accepted": "driver-assigned",
  "en-route-pickup": "dispatched",
  "at-pickup": "at-pickup",
  "in-transit": "in-transit",
  "at-delivery": "at-delivery",
  delivered: "delivered",
  "pod-uploaded": "pod-uploaded",
  completed: "completed",
};

/**
 * The `loadStatus` an ops write-through may set, or undefined to leave it as is.
 *
 * Refuses to move the load backwards, and refuses any move the lifecycle table
 * does not allow — the board must not be able to write a status the API would
 * reject, or the write silently fails and the two views diverge.
 */
export function loadStatusForCloudWrite(
  state: TrackingState,
  current?: string,
): LoadStatus | undefined {
  const mapped = LOAD_STATUS_BY_TRACKING_STATE[state];
  if (!mapped) return undefined;

  const from = normalizeLoadStatus(current);
  if (!from) return mapped;
  if (from === mapped) return undefined;

  const check = checkLoadTransition(from, mapped);
  return check.ok ? mapped : undefined;
}

export function driverWorkflowForCloudWrite(
  state: TrackingState,
  current?: string,
): string | undefined {
  const mapped = DRIVER_WORKFLOW_BY_TRACKING_STATE[state];
  if (!mapped) return undefined;
  const now = (current ?? "").trim().toLowerCase();
  if (!now) return mapped;
  const from = DRIVER_WORKFLOW_ORDER.indexOf(now);
  const to = DRIVER_WORKFLOW_ORDER.indexOf(mapped);
  // Tracking collapses some driver steps (both "loaded" and "at-pickup" derive to
  // at-pickup), so a naive write-back would walk the driver backwards. Never regress.
  if (from >= 0 && to >= 0 && to < from) return undefined;
  return mapped;
}

const PROGRESS_BY_STATE: Record<TrackingState, number> = {
  "waiting-driver": 0,
  "driver-assigned": 0,
  "driver-accepted": 5,
  "en-route-pickup": 12,
  "at-pickup": 28,
  "in-transit": 64,
  "at-delivery": 90,
  delivered: 98,
  "pod-uploaded": 100,
  completed: 100,
  exception: 0,
};

/**
 * Map driver-portal `driverWorkflowStatus` (+ loadStatus/docs) onto TrackingState.
 * Driver portal uses "assigned" for accepted; tracking uses "driver-accepted".
 */
export function deriveTrackingStateFromLoad(load: LoadRecord): TrackingState {
  const loadStatus = (load.loadStatus ?? "").trim().toLowerCase();
  if (loadStatus === "completed" || loadStatus === "cancelled" || loadStatus === "canceled") {
    return loadStatus === "completed" ? "completed" : "exception";
  }
  if (loadStatus === "delivered") {
    const hasPod =
      (load.documentAssets ?? []).some((a) => a.kind === "pod") ||
      (load.documents ?? []).some((d) => d.startsWith("pod:"));
    return hasPod ? "pod-uploaded" : "delivered";
  }

  const workflow = (load.driverWorkflowStatus ?? "").trim().toLowerCase();
  switch (workflow) {
    case "assigned":
    case "driver-accepted":
    case "accepted":
      return "driver-accepted";
    case "en-route-pickup":
    case "en_route_pickup":
      return "en-route-pickup";
    case "at-pickup":
      return "at-pickup";
    case "loaded":
      return "at-pickup";
    case "en-route-delivery":
    case "en_route_delivery":
    case "in-transit":
      return "in-transit";
    case "at-delivery":
      return "at-delivery";
    case "delivered":
      return "delivered";
    case "pod-uploaded":
    case "completed":
      return workflow === "completed" ? "completed" : "pod-uploaded";
    case "declined":
      // Driver rejected the assignment — surface it as an exception so dispatch reassigns.
      return "exception";
    default:
      break;
  }

  // History fallback when workflow field is missing but driver already advanced.
  // Ordered by server time where present — a device with a wrong clock can append
  // out of order, and "last element" would then read as the latest status.
  const latest = latestDriverStatus(load.driverStatusHistory);
  if (latest?.status) {
    const fromHistory = deriveTrackingStateFromLoad({
      ...load,
      driverWorkflowStatus: latest.status,
      driverStatusHistory: undefined,
    });
    if (fromHistory !== "waiting-driver") return fromHistory;
  }

  // Dispatch can also advance a load by hand on the Loads page; honour that so the
  // board does not sit on "Waiting for Driver" for a truck that is already rolling.
  const fromLoadStatus = TRACKING_STATE_BY_LOAD_STATUS[loadStatus];
  if (fromLoadStatus) return fromLoadStatus;

  /**
   * Assigned in ops, but the driver has not answered.
   *
   * This is the case behind the "status is still Awaiting Driver" report. The
   * statuses below deliberately do not imply driver acceptance — that is correct
   * and unchanged — but a load with a driver on it is not the same as a load with
   * nobody on it, and the board was showing both as "Waiting for Driver". Dispatch
   * could not tell which loads still needed chasing.
   */
  if (load.assignedDriver?.trim()) return "driver-assigned";

  return "waiting-driver";
}

function applyDerivedTrackingState(
  session: TrackingSession,
  state: TrackingState,
): TrackingSession {
  if (session.trackingState === "exception" && state === "waiting-driver") {
    return session;
  }
  const next = { ...session, trackingState: state };
  next.routeProgressPct = Math.max(next.routeProgressPct, PROGRESS_BY_STATE[state] ?? 0);
  next.milesRemaining = Math.max(
    0,
    Math.round((1 - next.routeProgressPct / 100) * next.milesTotal),
  );
  next.isActive = !["waiting-driver", "completed", "exception"].includes(state);
  if (state === "driver-accepted" && !next.acceptedAt) {
    next.acceptedAt = next.updatedAt;
  }
  if (state === "delivered" && !next.deliveredAt) {
    next.deliveredAt = next.updatedAt;
  }
  if ((state === "pod-uploaded" || state === "completed") && !next.podUploadedAt) {
    next.podUploadedAt = next.updatedAt;
  }
  if (state === "completed" && !next.completedAt) {
    next.completedAt = next.updatedAt;
  }
  return next;
}

function timelineActionForState(
  state: TrackingState,
): DriverWorkflowAction | "driver-assigned" | "auto-completed" {
  switch (state) {
    case "driver-accepted":
      return "accept-load";
    case "en-route-pickup":
      return "start-route-pickup";
    case "at-pickup":
      return "arrived-pickup";
    case "in-transit":
      return "in-transit";
    case "at-delivery":
      return "arrived-delivery";
    case "delivered":
      return "delivered";
    case "pod-uploaded":
      return "upload-pod";
    case "completed":
      return "auto-completed";
    default:
      return "driver-assigned";
  }
}

const syncedLoadVersions = new Map<string, string>();

/** Sync sessions only for loads whose `updatedAt` changed since the last sync. */
export function syncTrackingSessionsForLoads(
  loads: LoadRecord[],
  dispatcherName = "Dispatcher",
  options?: { force?: boolean; pinnedLoadId?: string | null },
) {
  const pinned = options?.pinnedLoadId?.trim() || null;
  const seen = new Set<string>();
  for (const load of loads) {
    // A load asked for by id is always synced, however finished it is. The
    // eligibility rules below declutter the live board — they are not access
    // control, and a deep link is a different intent: "show me this one".
    const isPinned = pinned !== null && load.loadId === pinned;
    if (!isPinned && !isLoadEligibleForTracking(load)) {
      if (sessionsByLoadId[load.loadId]) {
        removeTrackingSessionForLoad(load.loadId);
      }
      continue;
    }
    seen.add(load.loadId);
    const prev = syncedLoadVersions.get(load.loadId);
    if (!options?.force && prev === load.updatedAt) continue;
    syncTrackingSessionForLoad(load, dispatcherName);
    syncedLoadVersions.set(load.loadId, load.updatedAt);
  }

  // Drop orphan sessions for loads that are no longer trackable / assigned
  if (options?.force) {
    bootIfNeeded();
    for (const loadId of Object.keys(sessionsByLoadId)) {
      if (seen.has(loadId) || loadId === pinned) continue;
      removeTrackingSessionForLoad(loadId);
    }
  }
}

/** Loads that should appear on the Tracking command center. */
export function isLoadEligibleForTracking(load: LoadRecord): boolean {
  if (!load.assignedDriver?.trim()) return false;

  const status = (load.loadStatus ?? "").trim().toLowerCase();
  const workflow = (load.driverWorkflowStatus ?? "").trim().toLowerCase();
  const hasDriverDocs = (load.documentAssets ?? []).some((a) => Boolean(a.dataUrl));

  if (
    status === "booked" ||
    status === "completed" ||
    status === "draft" ||
    status === "cancelled" ||
    status === "canceled"
  ) {
    return false;
  }

  if (workflow === "completed") return false;

  // Keep delivered loads visible while driver BOL/POD files exist so dispatch can review.
  if (status === "delivered" || workflow === "delivered") {
    return hasDriverDocs;
  }

  return true;
}

/**
 * Hide terminal / non-operational sessions from the Tracking UI.
 *
 * Board decluttering, **not** access control. A finished load is hidden so the live
 * board shows trucks that are moving — but anyone who navigates to a specific load
 * is entitled to see it. Callers handling a deep link should pass `pinnedLoadId`.
 *
 * Without this exemption the Accounting page's "Track" button could never work: it
 * only appears on invoice rows, an invoice only exists for a delivered or completed
 * load, and every one of those is hidden by the rules below.
 */
export function isTrackingSessionVisible(
  session: TrackingSession,
  pinnedLoadId?: string | null,
): boolean {
  if (pinnedLoadId && session.loadId === pinnedLoadId) return true;
  if (session.trackingState === "completed") return false;
  if (session.trackingState === "delivered" || session.trackingState === "pod-uploaded") {
    return session.documents.some(
      (d) => Boolean(d.viewUrl) && (d.type === "BOL" || d.type === "POD"),
    );
  }
  return true;
}

export function clearTrackingSyncVersions() {
  syncedLoadVersions.clear();
}

export function removeTrackingSessionForLoad(loadId: string) {
  bootIfNeeded();
  if (!sessionsByLoadId[loadId]) return;
  const { [loadId]: _removed, ...rest } = sessionsByLoadId;
  sessionsByLoadId = rest;
  syncedLoadVersions.delete(loadId);
  emit();
}

export function syncTrackingSessionForLoad(load: LoadRecord, dispatcherName = "Dispatcher") {
  bootIfNeeded();
  if (!isLoadEligibleForTracking(load)) {
    removeTrackingSessionForLoad(load.loadId);
    return null;
  }

  const normalized = normalizeLoadForDriverAssignment(load);
  const assignedDriverId = (load.assignedDriver ?? "").trim();
  if (!assignedDriverId) {
    removeTrackingSessionForLoad(normalized.loadId);
    return null;
  }
  const existing = sessionsByLoadId[normalized.loadId];
  const historyName = [...(load.driverStatusHistory ?? [])]
    .reverse()
    .find((e) => e.byName?.trim())?.byName;
  const assignedDriverName = historyName?.trim() || driverNameFromId(assignedDriverId);

  // Prefer Dynamo trackingSession when newer than local cache (cross-browser sync)
  const cloud = load.trackingSession;
  const cloudWins =
    Boolean(cloud) &&
    (!existing ||
      Date.parse(cloud!.updatedAt) >= Date.parse(existing.updatedAt) ||
      TRACKING_STATE_RANK[cloud!.trackingState] > TRACKING_STATE_RANK[existing.trackingState]);

  const hydratedExisting =
    cloudWins && cloud
      ? mergeCloudIntoSession(
          cloud,
          existing ??
            ({
              loadId: normalized.loadId,
              trackingState: cloud.trackingState,
              assignedDriverId,
              assignedDriverName,
              dispatcherName,
              isActive: cloud.isActive,
              pickup: cloud.pickup,
              delivery: cloud.delivery,
              createdAt: cloud.createdAt,
              updatedAt: cloud.updatedAt,
              customerTrackingLink: cloud.customerTrackingLink,
              routeProgressPct: cloud.routeProgressPct,
              milesTotal: cloud.milesTotal,
              milesRemaining: cloud.milesRemaining,
              eta: cloud.eta,
              gps: cloud.gps,
              geofence: cloud.geofence,
              timeline: cloud.timeline,
              alerts: cloud.alerts,
              messages: [],
              documents: [],
            } satisfies TrackingSession),
        )
      : existing;

  const pickupCoord = inferLocationFromLoad(normalized, "pickup");
  const deliveryCoord = inferLocationFromLoad(normalized, "delivery");
  const milesTotal = hydratedExisting?.milesTotal ?? estimateMiles(pickupCoord, deliveryCoord);
  const now = nowIso();
  const derivedState = deriveTrackingStateFromLoad(normalized);

  let next: TrackingSession = hydratedExisting
    ? {
        ...hydratedExisting,
        assignedDriverId,
        assignedDriverName,
        dispatcherName,
        pickup: {
          city: normalized.pickupCity ?? hydratedExisting.pickup.city,
          state: normalized.pickupState ?? hydratedExisting.pickup.state,
          facility: normalized.pickupFacility ?? hydratedExisting.pickup.facility,
          address: normalized.pickupAddress ?? hydratedExisting.pickup.address,
          date: normalized.pickupDate ?? hydratedExisting.pickup.date,
        },
        delivery: {
          city: normalized.deliveryCity ?? hydratedExisting.delivery.city,
          state: normalized.deliveryState ?? hydratedExisting.delivery.state,
          facility: normalized.deliveryFacility ?? hydratedExisting.delivery.facility,
          address: normalized.deliveryAddress ?? hydratedExisting.delivery.address,
          date: normalized.deliveryDate ?? hydratedExisting.delivery.date,
        },
        commodity: normalized.commodityDescription ?? hydratedExisting.commodity,
        equipment: normalized.equipmentType ?? hydratedExisting.equipment,
        customer: normalized.customer ?? hydratedExisting.customer,
        carrier: normalized.assignedCarrier ?? hydratedExisting.carrier,
        updatedAt: now,
      }
    : {
        loadId: normalized.loadId,
        trackingState: "waiting-driver",
        assignedDriverId,
        assignedDriverName,
        dispatcherName,
        isActive: false,
        pickup: {
          city: normalized.pickupCity ?? "Pickup",
          state: normalized.pickupState ?? "",
          facility: normalized.pickupFacility ?? "Pickup Facility",
          address: normalized.pickupAddress,
          date: normalized.pickupDate,
        },
        delivery: {
          city: normalized.deliveryCity ?? "Delivery",
          state: normalized.deliveryState ?? "",
          facility: normalized.deliveryFacility ?? "Delivery Facility",
          address: normalized.deliveryAddress,
          date: normalized.deliveryDate,
        },
        equipment: normalized.equipmentType,
        commodity: normalized.commodityDescription,
        customer: normalized.customer,
        carrier: normalized.assignedCarrier,
        createdAt: now,
        updatedAt: now,
        customerTrackingLink: buildCustomerTrackingLink(normalized.loadId),
        routeProgressPct: 0,
        milesTotal,
        milesRemaining: milesTotal,
        eta: null,
        gps: {
          location: pickupCoord,
          speedMph: 0,
          headingDeg: 0,
          lastPingAt: now,
          source: "simulated",
        },
        geofence: {},
        timeline: [],
        alerts: [],
        messages: [
          {
            id: `${normalized.loadId}-welcome`,
            from: "system",
            text:
              derivedState === "waiting-driver"
                ? `Tracking session created for ${normalized.loadId}. Waiting for driver acceptance.`
                : `Tracking session created for ${normalized.loadId}. Driver workflow: ${TRACKING_STATE_LABELS[derivedState]}.`,
            timestamp: now,
          },
        ],
        documents: [],
      };

  const driverChanged = Boolean(
    hydratedExisting && hydratedExisting.assignedDriverId !== assignedDriverId,
  );
  if (!hydratedExisting || driverChanged) {
    next.timeline = [
      ...next.timeline,
      makeTimelineEvent(next, {
        action: "driver-assigned",
        state: derivedState === "waiting-driver" ? "waiting-driver" : derivedState,
        user: dispatcherName,
        source: "dispatcher",
        notes: `${assignedDriverName} assigned to ${normalized.loadId}.`,
        location: pickupCoord,
      }),
    ];
  }

  // Prefer Dynamo driver workflow over stale local "waiting-driver" sessions.
  const shouldApplyDerived =
    !hydratedExisting ||
    driverChanged ||
    TRACKING_STATE_RANK[derivedState] >= TRACKING_STATE_RANK[next.trackingState] ||
    (next.trackingState === "waiting-driver" && derivedState !== "waiting-driver");

  if (shouldApplyDerived) {
    const prevState = next.trackingState;
    next = applyDerivedTrackingState(next, derivedState);
    if (
      hydratedExisting &&
      !driverChanged &&
      prevState !== derivedState &&
      derivedState !== "waiting-driver"
    ) {
      const action = timelineActionForState(derivedState);
      next.timeline = [
        ...next.timeline,
        makeTimelineEvent(next, {
          action,
          state: derivedState,
          user: assignedDriverName,
          source: "driver-app",
          notes: `Driver portal updated status to ${TRACKING_STATE_LABELS[derivedState]}.`,
          location: next.gps.location,
        }),
      ];
    }
  }

  // Merge live driver BOL/POD uploads from the Loads record
  const rateDoc =
    hydratedExisting?.documents.find((d) => d.type === "Rate Conf.") ??
    ({
      id: `${normalized.loadId}-rate`,
      name: "Rate confirmation",
      type: "Rate Conf." as const,
      status: "Received" as const,
      uploadedAt: next.createdAt ?? now,
    } satisfies TrackingDocument);

  next.documents = [
    rateDoc,
    ...trackingDocumentsFromLoad({
      loadId: normalized.loadId,
      documentAssets: normalized.documentAssets,
      documents: normalized.documents,
      updatedAt: normalized.updatedAt,
    }),
  ];

  // Prefer live device GPS from the driver portal when fresh
  if (isDriverGpsFresh(normalized.driverGps)) {
    const ping = normalized.driverGps!;
    next.gps = {
      location: {
        lat: ping.lat,
        lng: ping.lng,
        label: ping.sharedByName ? `${ping.sharedByName} (live)` : "Driver (live)",
      },
      speedMph: ping.speedMph ?? next.gps.speedMph,
      headingDeg: ping.headingDeg ?? next.gps.headingDeg,
      lastPingAt: ping.lastPingAt,
      source: "driver",
      accuracyM: ping.accuracyM,
    };
  }

  // Mark POD doc received when workflow says so
  if (derivedState === "pod-uploaded" || derivedState === "completed") {
    next.documents = next.documents.map((doc) =>
      doc.type === "POD"
        ? {
            ...doc,
            status: "Received",
            uploadedAt: doc.uploadedAt ?? now,
          }
        : doc,
    );
  }

  sessionsByLoadId = { ...sessionsByLoadId, [normalized.loadId]: next };
  syncedLoadVersions.set(normalized.loadId, normalized.updatedAt);
  emit();
  ensureTicker();

  if (!existing && isTrackingMessagesConfigured() && next.messages[0]) {
    const welcome = next.messages[0];
    void putTrackingMessage({
      loadId: normalized.loadId,
      messageId: welcome.id,
      from: welcome.from,
      text: welcome.text,
      timestamp: welcome.timestamp,
    }).catch((err) => {
      console.error("[tracking] persist welcome message failed", err);
    });
  }

  void hydrateSessionMessages(normalized.loadId);
  return next;
}

/** Merge DynamoDB messages into the in-memory session (newest source of truth). */
export async function hydrateSessionMessages(loadId: string) {
  if (!isTrackingMessagesConfigured()) return;
  bootIfNeeded();
  const current = sessionsByLoadId[loadId];
  if (!current) return;

  try {
    const remote = await listTrackingMessages(loadId);
    if (remote.length === 0) return;

    const byId = new Map<string, TrackingMessage>();
    for (const message of remote) {
      byId.set(message.id, {
        id: message.id,
        from: message.from,
        text: message.text,
        timestamp: message.timestamp,
        docKind: message.docKind,
        fileName: message.fileName,
        contentType: message.contentType,
        assetId: message.assetId,
      });
    }
    for (const message of current.messages) {
      if (!byId.has(message.id)) {
        byId.set(message.id, message);
      }
    }

    const merged = [...byId.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    sessionsByLoadId = {
      ...sessionsByLoadId,
      [loadId]: { ...current, messages: merged },
    };
    emit();
  } catch (err) {
    console.error("[tracking] hydrateSessionMessages failed", err);
  }
}

export function getNextDriverActions(state: TrackingState): DriverWorkflowAction[] {
  if (state === "waiting-driver") return ["accept-load", "decline-load"];
  if (state === "driver-assigned") return ["accept-load", "decline-load"];
  if (state === "driver-accepted") return ["start-route-pickup"];
  if (state === "en-route-pickup") return ["arrived-pickup"];
  if (state === "at-pickup") return ["checkin-pickup", "loaded", "depart-pickup"];
  if (state === "in-transit") return ["arrived-delivery"];
  if (state === "at-delivery") return ["checkin-delivery", "delivered"];
  if (state === "delivered") return ["upload-pod"];
  if (state === "pod-uploaded") return ["complete-load"];
  return [];
}

/**
 * Is this action legal from this state?
 *
 * `decline-load` is exempt: it is how `reportTrackingException` raises an
 * exception, and a load can hit trouble at any point in its run. Every other
 * action must be one the state actually offers.
 */
export function canApplyDriverAction(state: TrackingState, action: DriverWorkflowAction): boolean {
  if (action === "decline-load") return true;
  return getNextDriverActions(state).includes(action);
}

export type DriverActionRejection = {
  ok: false;
  code: "no_session" | "illegal_transition";
  message: string;
};

/** The last rejection, for callers that want to surface it. */
let lastDriverActionRejection: DriverActionRejection | null = null;

export function consumeDriverActionRejection(): DriverActionRejection | null {
  const rejection = lastDriverActionRejection;
  lastDriverActionRejection = null;
  return rejection;
}

export function applyDriverAction(
  loadId: string,
  action: DriverWorkflowAction,
  opts?: { user?: string; source?: TimelineSource; notes?: string },
) {
  bootIfNeeded();
  lastDriverActionRejection = null;
  const current = sessionsByLoadId[loadId];
  if (!current) {
    lastDriverActionRejection = {
      ok: false,
      code: "no_session",
      message: `No tracking session for ${loadId}.`,
    };
    return null;
  }

  /**
   * The guard that was missing.
   *
   * `getNextDriverActions` computed the legal action set and fed the UI's buttons,
   * but this function never consulted it — so 120 of the 130 state × action
   * combinations applied, and 55 of them walked the load *backwards*. A dispatcher
   * could put a completed load back to "Driver Accepted", and because
   * `routeProgressPct` is monotonic the board would then show "Driver Accepted"
   * next to a 98% progress bar.
   *
   * A hidden button is not a guard. This is.
   */
  if (!canApplyDriverAction(current.trackingState, action)) {
    const allowed = getNextDriverActions(current.trackingState);
    lastDriverActionRejection = {
      ok: false,
      code: "illegal_transition",
      message: allowed.length
        ? `A load at "${TRACKING_STATE_LABELS[current.trackingState]}" cannot ${DRIVER_ACTION_LABELS[action]}. Available: ${allowed
            .map((a) => DRIVER_ACTION_LABELS[a])
            .join(", ")}.`
        : `This load is ${TRACKING_STATE_LABELS[current.trackingState]} and has no remaining driver actions.`,
    };
    console.warn("[tracking] rejected driver action", {
      loadId,
      from: current.trackingState,
      action,
    });
    return null;
  }

  const user = opts?.user ?? current.assignedDriverName;
  const source = opts?.source ?? "driver-app";
  const now = nowIso();

  const next = { ...current };

  if (action === "decline-load") {
    next.trackingState = "exception";
    next.isActive = false;
    next.updatedAt = now;
    next.alerts = [
      {
        id: `${loadId}-decline-${Date.now()}`,
        title: "Driver declined load",
        detail: opts?.notes ?? `${current.assignedDriverName} declined ${loadId}.`,
        tone: "destructive",
        timestamp: now,
      },
      ...next.alerts,
    ];
    next.timeline = [
      ...next.timeline,
      makeTimelineEvent(next, {
        action,
        state: "exception",
        user,
        source,
        notes: opts?.notes ?? "Driver declined assignment.",
      }),
    ];
    sessionsByLoadId = { ...sessionsByLoadId, [loadId]: next };
    emit("immediate");
    // Explicit dispatcher action on the Driver Actions row — allowed to speak for
    // the driver, unlike background write-throughs.
    scheduleCloudPersist(loadId, "immediate", { propagateDriverStatus: true });
    ensureTicker();
    return next;
  }

  const stateByAction: Partial<Record<DriverWorkflowAction, TrackingState>> = {
    "accept-load": "driver-accepted",
    "start-route-pickup": "en-route-pickup",
    "arrived-pickup": "at-pickup",
    "checkin-pickup": "at-pickup",
    loaded: "at-pickup",
    "depart-pickup": "in-transit",
    "in-transit": "in-transit",
    "arrived-delivery": "at-delivery",
    "checkin-delivery": "at-delivery",
    delivered: "delivered",
    "upload-pod": "pod-uploaded",
    "complete-load": "completed",
  };

  const progressByAction: Partial<Record<DriverWorkflowAction, number>> = {
    "accept-load": 5,
    "start-route-pickup": 12,
    "arrived-pickup": 24,
    "checkin-pickup": 28,
    loaded: 34,
    "depart-pickup": 44,
    "in-transit": 64,
    "arrived-delivery": 90,
    "checkin-delivery": 94,
    delivered: 98,
    "upload-pod": 100,
    "complete-load": 100,
  };

  const nextState = stateByAction[action] ?? next.trackingState;
  next.trackingState = nextState;
  next.routeProgressPct = Math.max(
    next.routeProgressPct,
    progressByAction[action] ?? next.routeProgressPct,
  );
  next.milesRemaining = Math.max(
    0,
    Math.round((1 - next.routeProgressPct / 100) * next.milesTotal),
  );
  next.isActive = !["completed", "exception"].includes(nextState);
  next.updatedAt = now;
  if (!next.startedAt && action !== "accept-load") next.startedAt = now;
  if (action === "accept-load") next.acceptedAt = now;
  if (action === "arrived-pickup") next.geofence.pickupArrivedAt = now;
  if (action === "arrived-delivery") next.geofence.deliveryArrivedAt = now;
  if (action === "delivered") next.deliveredAt = now;
  if (action === "upload-pod") next.podUploadedAt = now;
  if (action === "complete-load") next.completedAt = now;

  next.timeline = [
    ...next.timeline,
    makeTimelineEvent(next, {
      action,
      state: nextState,
      user,
      source,
      notes: opts?.notes,
    }),
  ];

  if (action === "accept-load") {
    next.messages = [
      ...next.messages,
      {
        id: `${loadId}-accept-${Date.now()}`,
        from: "system",
        text: `${next.assignedDriverName} accepted load ${loadId}. Active tracking started.`,
        timestamp: now,
      },
    ];
  }

  if (action === "upload-pod") {
    next.documents = next.documents.map((doc) =>
      doc.type === "POD" ? { ...doc, status: "Received", uploadedAt: doc.uploadedAt ?? now } : doc,
    );
    next.isActive = false;
  }

  if (action === "complete-load") {
    next.documents = next.documents.map((doc) =>
      doc.type === "POD" ? { ...doc, status: "Received", uploadedAt: doc.uploadedAt ?? now } : doc,
    );
    next.isActive = false;
    next.completedAt = now;
  }

  sessionsByLoadId = { ...sessionsByLoadId, [loadId]: next };
  emit("immediate");
  scheduleCloudPersist(loadId, "immediate", { propagateDriverStatus: true });
  ensureTicker();
  return next;
}

export function reportTrackingException(loadId: string, detail: string, user = "Dispatcher") {
  return applyDriverAction(loadId, "decline-load", {
    user,
    source: "dispatcher",
    notes: detail,
  });
}

/**
 * Ops close-out: verify POD on file, persist load as completed, drop from live Tracking.
 * Brokerage next step after delivery + POD upload.
 */
export async function completeTrackingLoadAfterPod(
  loadId: string,
  opts?: { user?: string; notes?: string },
) {
  const { getLoadById, patchLoad } = await import("../loads-store");
  const { upsertOperationalListItem, getOperationalCacheScope } =
    await import("../operational-data-cache");

  const load = await getLoadById(loadId);
  if (!load) {
    throw new Error(`Load ${loadId} was not found.`);
  }

  const hasPod =
    (load.documentAssets ?? []).some((a) => a.kind === "pod" && a.dataUrl) ||
    (load.documents ?? []).some((d) => d.startsWith("pod:"));

  if (!hasPod) {
    throw new Error("POD is not on file yet. Ask the driver to upload Proof of Delivery first.");
  }

  const session = applyDriverAction(loadId, "complete-load", {
    user: opts?.user ?? "Dispatcher",
    source: "dispatcher",
    notes:
      opts?.notes ??
      "POD verified by dispatch. Load marked completed — ready for billing / invoice.",
  });

  // Close-out owns exactly these three attributes. A whole-item Put here would rewrite
  // the driver's docs and GPS from a read that may already be out of date.
  const changes = {
    loadStatus: "completed",
    driverWorkflowStatus: "completed",
    trackingSession: session ? toTrackingSessionCloud(session) : load.trackingSession,
  };
  await patchLoad(loadId, changes);
  const updated = { ...load, ...changes, updatedAt: new Date().toISOString() };
  upsertOperationalListItem("loads", getOperationalCacheScope(), updated, (row) => row.loadId);

  // Force session off the live board
  removeTrackingSessionForLoad(loadId);
  return updated;
}

export async function sendTrackingMessage(
  loadId: string,
  from: TrackingMessage["from"],
  text: string,
) {
  bootIfNeeded();
  const current = sessionsByLoadId[loadId];
  if (!current || !text.trim()) return;

  const now = nowIso();
  const messageId = createTrackingMessageId(loadId);
  const message: TrackingMessage = {
    id: messageId,
    from,
    text: text.trim(),
    timestamp: now,
  };

  if (isTrackingMessagesConfigured()) {
    try {
      await putTrackingMessage({
        loadId,
        messageId,
        from,
        text: message.text,
        timestamp: now,
      });
    } catch (err) {
      console.error("[tracking] save message to DynamoDB failed", err);
    }
  }

  const next: TrackingSession = {
    ...current,
    messages: [...current.messages, message],
    updatedAt: now,
  };
  sessionsByLoadId = { ...sessionsByLoadId, [loadId]: next };
  emit();
}

export async function deleteTrackingMessage(loadId: string, messageId: string) {
  bootIfNeeded();
  const current = sessionsByLoadId[loadId];
  if (!current) return;

  if (isTrackingMessagesConfigured()) {
    try {
      await deleteTrackingMessageRecord(loadId, messageId);
    } catch (err) {
      if (isDynamoResourceNotFound(err)) {
        console.warn(
          "[tracking] TrackingMessages table missing in DynamoDB — removed message locally only.",
          err,
        );
      } else {
        console.error("[tracking] delete message from DynamoDB failed", err);
        throw err;
      }
    }
  }

  const next: TrackingSession = {
    ...current,
    messages: current.messages.filter((message) => message.id !== messageId),
    updatedAt: nowIso(),
  };
  sessionsByLoadId = { ...sessionsByLoadId, [loadId]: next };
  emit();
}
