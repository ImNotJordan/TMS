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
  | "upload-pod"
  | "complete-load";

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
  docKind?: "bol" | "pod";
  fileName?: string;
  contentType?: string;
  assetId?: string;
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
  contentType?: string;
  viewUrl?: string;
  uploadedByName?: string;
  size?: number;
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
  gps: {
    location: TrackingLocation;
    speedMph: number;
    headingDeg: number;
    lastPingAt: string;
    /** Live device share from driver portal vs simulated route progress. */
    source?: "driver" | "simulated";
    accuracyM?: number;
  };
  geofence: { pickupArrivedAt?: string; deliveryArrivedAt?: string };
  timeline: TrackingTimelineEvent[];
  alerts: TrackingAlert[];
  messages: TrackingMessage[];
  documents: TrackingDocument[];
};

/** Dynamo-safe session payload stored on Loads (no message bodies / data URLs). */
export type TrackingSessionCloud = Omit<TrackingSession, "messages" | "documents"> & {
  documentMeta?: Array<Omit<TrackingDocument, "viewUrl">>;
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
  "complete-load": "Verify POD & complete",
};
