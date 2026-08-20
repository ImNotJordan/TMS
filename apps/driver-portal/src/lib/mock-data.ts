export type LoadStop = {
  city: string;
  state: string;
  address: string;
  window: string;
};

export type ActiveLoadStatus =
  | "assigned"
  | "en-route-pickup"
  | "at-pickup"
  | "loaded"
  | "en-route-delivery"
  | "at-delivery"
  | "delivered";

export type LoadStatus = "offered" | ActiveLoadStatus | "declined";

export const STATUS_STEPS: { key: ActiveLoadStatus; label: string }[] = [
  { key: "assigned", label: "Assigned" },
  { key: "en-route-pickup", label: "En route to pickup" },
  { key: "at-pickup", label: "Arrived at pickup" },
  { key: "loaded", label: "Loaded" },
  { key: "en-route-delivery", label: "En route to delivery" },
  { key: "at-delivery", label: "Arrived at delivery" },
  { key: "delivered", label: "Delivered" },
];

export const STATUS_LABELS: Record<LoadStatus, string> = {
  offered: "New offer",
  assigned: "Assigned",
  "en-route-pickup": "En route to pickup",
  "at-pickup": "Arrived at pickup",
  loaded: "Loaded",
  "en-route-delivery": "En route to delivery",
  "at-delivery": "Arrived at delivery",
  delivered: "Delivered",
  declined: "Declined",
};

export type LoadDocument = {
  type: "Bill of Lading" | "Proof of Delivery";
  fileName?: string;
  uploadedAt?: string;
  contentType?: string;
  viewUrl?: string;
  size?: number;
  assetId?: string;
};

export type Load = {
  id: string;
  status: LoadStatus;
  /** Dispatch assigned this driver directly and is waiting on their acceptance. */
  assignedByDispatch?: boolean;
  equipment: string;
  distanceMiles: number;
  rate: number;
  weightLbs: number;
  pickup: LoadStop;
  delivery: LoadStop;
  brokerName: string;
  notes?: string;
  documents: LoadDocument[];
};

export type ActivityItem = {
  id: string;
  title: string;
  detail: string;
  time: string;
};

export type ChatMessage = {
  id: string;
  from: "driver" | "ai";
  text: string;
  time: string;
};

export const QUICK_REPLIES = [
  "I'm running 30 min late",
  "What's my next stop?",
  "Upload my POD",
  "Call dispatch",
];
