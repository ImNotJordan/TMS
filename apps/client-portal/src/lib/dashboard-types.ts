/**
 * Client dashboard DTO — mirrors `src/lib/client-dashboard-proxy.ts`.
 * Kept local so this SPA does not import the operations console.
 */
export type ClientTaxLine = {
  label: string;
  amount: number;
  currency: "USD" | "CNY" | "UNKNOWN";
  country: "US" | "CN" | "UNKNOWN";
  note?: string;
};

export type ClientTaxSnapshot = {
  amount: number;
  currency: "USD" | "CNY" | "UNKNOWN";
  source: "manual" | "estimate";
  country: "US" | "CN" | "UNKNOWN";
  regime: string;
  label: string;
  confidence: string;
  note?: string;
  lines: ClientTaxLine[];
};

export type ClientDashboardGps = {
  lat: number;
  lng: number;
  lastPingAt: string;
  source: "driver";
  fresh: boolean;
};

export type ClientDashboardLoad = {
  loadId: string;
  loadStatus: string;
  trackingState?: string;
  customer: string;
  pickupFacility?: string;
  pickupAddress?: string;
  pickupCity?: string;
  pickupState?: string;
  pickupZip?: string;
  pickupDate?: string;
  deliveryFacility?: string;
  deliveryAddress?: string;
  deliveryCity?: string;
  deliveryState?: string;
  deliveryZip?: string;
  deliveryDate?: string;
  equipmentType?: string;
  commodityDescription?: string;
  weight?: string;
  weightUnit?: string;
  eta?: string | null;
  routeProgressPct?: number;
  gps: ClientDashboardGps | null;
  billedAmount: number | null;
  tax: ClientTaxSnapshot;
};

export type ClientDashboardTaxTotal = {
  currency: ClientTaxSnapshot["currency"];
  amount: number;
};

export type ClientDashboardResponse = {
  companyName: string;
  assignedCustomers: string[];
  generatedAt: string;
  maps: { apiKey: string } | null;
  summary: {
    activeCount: number;
    inTransitCount: number;
    trackedCount: number;
    billedTotal: number;
    taxTotal: number;
    currency: ClientTaxSnapshot["currency"];
    taxTotals: ClientDashboardTaxTotal[];
  };
  loads: ClientDashboardLoad[];
};
