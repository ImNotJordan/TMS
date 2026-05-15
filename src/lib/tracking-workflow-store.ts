import type { LoadRecord } from "./loads-store";

type TrackingListener = () => void;

export type TrackingState =
  | "waiting-driver"
  | "driver-accepted"
  | "en-route-pickup"
  | "at-pickup"
  | "in-transit"
  | "at-delivery"
  | "delivered"
  | "pod-uploaded"
  | "completed"
  | "exception";

export type DriverWorkflowAction =
  | "accept-load"
  | "decline-load"
  | "start-route-pickup"
  | "arrived-pickup"
  | "checkin-pickup"
  | "loaded"
  | "depart-pickup"
  | "in-transit"
  | "arrived-delivery"
  | "checkin-delivery"
  | "delivered"
  | "upload-pod";

export type TimelineSource = "driver-app" | "dispatcher" | "geofence" | "gps" | "system";

export type TrackingLocation = {
  lat: number;
  lng: number;
  city?: string;
  state?: string;
  label?: string;
};

export type TrackingTimelineEvent = {
  id: string;
  action: DriverWorkflowAction | "driver-assigned" | "exception-reported" | "auto-completed";
  state: TrackingState;
  timestamp: string;
  location: TrackingLocation;
  user: string;
  source: TimelineSource;
  notes?: string;
};

export type TrackingMessage = {
  id: string;
  from: "driver" | "ops" | "system";
  text: string;
  timestamp: string;
};

export type TrackingAlert = {
  id: string;
  title: string;
  detail: string;
  tone: "warning" | "destructive" | "info" | "success";
  timestamp: string;
};

export type TrackingDocument = {
  id: string;
  name: string;
  type: "BOL" | "POD" | "Photo" | "Rate Conf." | "Lumper" | "Other";
  status: "Pending" | "Received" | "Required";
  uploadedAt?: string;
};

export type TrackingSession = {
  loadId: string;
  trackingState: TrackingState;
  assignedDriverId: string;
  assignedDriverName: string;
  dispatcherName: string;
  isActive: boolean;
  pickup: { city: string; state: string; facility: string; address?: string; date?: string };
  delivery: { city: string; state: string; facility: string; address?: string; date?: string };
  equipment?: string;
  commodity?: string;
  customer?: string;
  carrier?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  acceptedAt?: string;
  deliveredAt?: string;
  podUploadedAt?: string;
  completedAt?: string;
  customerTrackingLink: string;
  routeProgressPct: number;
  milesTotal: number;
  milesRemaining: number;
  eta: string | null;
  gps: { location: TrackingLocation; speedMph: number; headingDeg: number; lastPingAt: string };
  geofence: { pickupArrivedAt?: string; deliveryArrivedAt?: string };
  timeline: TrackingTimelineEvent[];
  alerts: TrackingAlert[];
  messages: TrackingMessage[];
  documents: TrackingDocument[];
};

export const TRACKING_STATE_LABELS: Record<TrackingState, string> = {
  "waiting-driver": "Waiting for Driver",
  "driver-accepted": "Driver Accepted",
  "en-route-pickup": "En Route to Pickup",
  "at-pickup": "At Pickup",
  "in-transit": "In Transit",
  "at-delivery": "At Delivery",
  delivered: "Delivered",
  "pod-uploaded": "POD Uploaded",
  completed: "Completed",
  exception: "Exception",
};

export const DRIVER_ACTION_LABELS: Record<DriverWorkflowAction, string> = {
  "accept-load": "Accept Load",
  "decline-load": "Decline Load",
  "start-route-pickup": "Start Route to Pickup",
  "arrived-pickup": "Arrived at Pickup",
  "checkin-pickup": "Check In at Pickup",
  loaded: "Loaded",
  "depart-pickup": "Depart Pickup",
  "in-transit": "In Transit",
  "arrived-delivery": "Arrived at Delivery",
  "checkin-delivery": "Check In at Delivery",
  delivered: "Delivered",
  "upload-pod": "Upload POD",
};

const DRIVER_NAME_BY_ID: Record<string, string> = {
  "d-101": "Dwayne Carter",
  "d-102": "Marisa Lopez",
  "d-201": "Sam Reyes",
  "d-301": "Tyrese Hill",
};

const STORAGE_KEY = "ls_tracking_sessions_v1";
const listeners = new Set<TrackingListener>();
let sessionsByLoadId: Record<string, TrackingSession> = {};
let bootstrapped = false;
let tickerHandle: ReturnType<typeof setInterval> | null = null;
let snapshotSourceRef: Record<string, TrackingSession> | null = null;
let snapshotCache: TrackingSession[] = [];

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
  } catch {
    // ignore storage errors
  }
}

function emit() {
  snapshotSourceRef = null;
  persist();
  for (const listener of listeners) listener();
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

function ensureTicker() {
  if (tickerHandle || typeof window === "undefined") return;
  tickerHandle = setInterval(() => {
    const next = { ...sessionsByLoadId };
    let changed = false;
    const now = Date.now();

    for (const [loadId, session] of Object.entries(next)) {
      if (!session.isActive) continue;
      if (
        !["en-route-pickup", "in-transit", "at-pickup", "at-delivery", "driver-accepted"].includes(
          session.trackingState,
        )
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

      session.routeProgressPct = progress;
      session.milesRemaining = milesRemaining;
      session.eta = eta;
      session.gps = {
        location: interpolateLocation(pickupCoord, deliveryCoord, progress),
        speedMph,
        headingDeg: Math.round(90 + ((now / 1000) % 180)),
        lastPingAt: nowIso(),
      };
      session.updatedAt = nowIso();
      changed = true;

      if (
        session.trackingState === "en-route-pickup" &&
        progress >= 20 &&
        !session.geofence.pickupArrivedAt
      ) {
        applyDriverAction(loadId, "arrived-pickup", {
          user: session.assignedDriverName,
          source: "geofence",
          notes: "Auto-detected pickup geofence arrival.",
        });
      }

      if (
        session.trackingState === "in-transit" &&
        progress >= 90 &&
        !session.geofence.deliveryArrivedAt
      ) {
        applyDriverAction(loadId, "arrived-delivery", {
          user: session.assignedDriverName,
          source: "geofence",
          notes: "Auto-detected delivery geofence arrival.",
        });
      }
    }

    if (changed) {
      sessionsByLoadId = next;
      emit();
    }
  }, 15000);
}

export function subscribeTrackingSessions(listener: TrackingListener): () => void {
  bootIfNeeded();
  listeners.add(listener);
  ensureTicker();
  return () => {
    listeners.delete(listener);
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

export function syncTrackingSessionForLoad(load: LoadRecord, dispatcherName = "Dispatcher") {
  bootIfNeeded();
  if (!load.assignedDriver) return null;

  const normalized = normalizeLoadForDriverAssignment(load);
  const existing = sessionsByLoadId[normalized.loadId];
  const pickupCoord = inferLocationFromLoad(normalized, "pickup");
  const deliveryCoord = inferLocationFromLoad(normalized, "delivery");
  const milesTotal = existing?.milesTotal ?? estimateMiles(pickupCoord, deliveryCoord);
  const assignedDriverName = driverNameFromId(normalized.assignedDriver);
  const now = nowIso();

  const next: TrackingSession = existing
    ? {
        ...existing,
        assignedDriverId: normalized.assignedDriver,
        assignedDriverName,
        dispatcherName,
        pickup: {
          city: normalized.pickupCity ?? existing.pickup.city,
          state: normalized.pickupState ?? existing.pickup.state,
          facility: normalized.pickupFacility ?? existing.pickup.facility,
          address: normalized.pickupAddress ?? existing.pickup.address,
          date: normalized.pickupDate ?? existing.pickup.date,
        },
        delivery: {
          city: normalized.deliveryCity ?? existing.delivery.city,
          state: normalized.deliveryState ?? existing.delivery.state,
          facility: normalized.deliveryFacility ?? existing.delivery.facility,
          address: normalized.deliveryAddress ?? existing.delivery.address,
          date: normalized.deliveryDate ?? existing.delivery.date,
        },
        commodity: normalized.commodityDescription ?? existing.commodity,
        equipment: normalized.equipmentType ?? existing.equipment,
        customer: normalized.customer ?? existing.customer,
        carrier: normalized.assignedCarrier ?? existing.carrier,
        updatedAt: now,
      }
    : {
        loadId: normalized.loadId,
        trackingState: "waiting-driver",
        assignedDriverId: normalized.assignedDriver,
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
        },
        geofence: {},
        timeline: [],
        alerts: [],
        messages: [
          {
            id: `${normalized.loadId}-welcome`,
            from: "system",
            text: `Tracking session created for ${normalized.loadId}. Waiting for driver acceptance.`,
            timestamp: now,
          },
        ],
        documents: [
          {
            id: `${normalized.loadId}-rate`,
            name: "Rate confirmation",
            type: "Rate Conf.",
            status: "Received",
            uploadedAt: now,
          },
          {
            id: `${normalized.loadId}-pod`,
            name: "Proof of delivery",
            type: "POD",
            status: "Pending",
          },
        ],
      };

  if (!existing || existing.assignedDriverId !== normalized.assignedDriver) {
    next.trackingState = "waiting-driver";
    next.isActive = false;
    next.timeline = [
      ...next.timeline,
      makeTimelineEvent(next, {
        action: "driver-assigned",
        state: "waiting-driver",
        user: dispatcherName,
        source: "dispatcher",
        notes: `${assignedDriverName} assigned to ${normalized.loadId}.`,
        location: pickupCoord,
      }),
    ];
  }

  sessionsByLoadId = { ...sessionsByLoadId, [normalized.loadId]: next };
  emit();
  return next;
}

export function getNextDriverActions(state: TrackingState): DriverWorkflowAction[] {
  if (state === "waiting-driver") return ["accept-load", "decline-load"];
  if (state === "driver-accepted") return ["start-route-pickup"];
  if (state === "en-route-pickup") return ["arrived-pickup"];
  if (state === "at-pickup") return ["checkin-pickup", "loaded", "depart-pickup"];
  if (state === "in-transit") return ["arrived-delivery"];
  if (state === "at-delivery") return ["checkin-delivery", "delivered"];
  if (state === "delivered") return ["upload-pod"];
  return [];
}

export function applyDriverAction(
  loadId: string,
  action: DriverWorkflowAction,
  opts?: { user?: string; source?: TimelineSource; notes?: string },
) {
  bootIfNeeded();
  const current = sessionsByLoadId[loadId];
  if (!current) return null;
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
    emit();
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
      doc.type === "POD" ? { ...doc, status: "Received", uploadedAt: now } : doc,
    );
    next.timeline = [
      ...next.timeline,
      makeTimelineEvent(next, {
        action: "auto-completed",
        state: "completed",
        user: "System",
        source: "system",
        notes: "POD uploaded. Tracking session marked completed.",
      }),
    ];
    next.trackingState = "completed";
    next.isActive = false;
    next.completedAt = now;
  }

  sessionsByLoadId = { ...sessionsByLoadId, [loadId]: next };
  emit();
  return next;
}

export function reportTrackingException(loadId: string, detail: string, user = "Dispatcher") {
  return applyDriverAction(loadId, "decline-load", {
    user,
    source: "dispatcher",
    notes: detail,
  });
}

export function sendTrackingMessage(loadId: string, from: TrackingMessage["from"], text: string) {
  bootIfNeeded();
  const current = sessionsByLoadId[loadId];
  if (!current || !text.trim()) return;
  const now = nowIso();
  const next: TrackingSession = {
    ...current,
    messages: [
      ...current.messages,
      {
        id: `${loadId}-msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        from,
        text: text.trim(),
        timestamp: now,
      },
    ],
    updatedAt: now,
  };
  sessionsByLoadId = { ...sessionsByLoadId, [loadId]: next };
  emit();
}
