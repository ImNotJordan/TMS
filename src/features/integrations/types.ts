import type { IntegrationConnectionStatus } from "@/lib/integrations-config";

/** Canonical integration ids used across Settings and Communications. */
export type IntegrationId =
  | "dat"
  | "twilio_sms"
  | "sendgrid_email"
  | "quickbooks"
  | "google_maps"
  | "stripe"
  | "ai"
  | "resend"
  | (string & {});

export type IntegrationStatus = "connected" | "disconnected" | "error" | "checking";

export type TestResult = {
  ok: boolean;
  message: string;
};

export interface IntegrationState {
  id: IntegrationId;
  name: string;
  status: IntegrationStatus;
  /** Display label matching Settings grid vocabulary. */
  connectionLabel: IntegrationConnectionStatus;
  lastSyncAt: string | null;
  lastSyncLabel: string;
  maskedConfig: Record<string, string>;
  capabilities: string[];
}

export const INTEGRATION_PROVIDERS: { id: IntegrationId; label: string }[] = [
  { id: "dat", label: "DAT" },
  { id: "twilio_sms", label: "Twilio SMS" },
  { id: "sendgrid_email", label: "SendGrid Email" },
  { id: "quickbooks", label: "QuickBooks" },
  { id: "google_maps", label: "Google Maps" },
  { id: "stripe", label: "Stripe" },
  { id: "ai", label: "AI" },
  { id: "resend", label: "Resend Email" },
];

/** Map Settings grid legacy ids → canonical ids. */
export function toCanonicalIntegrationId(id: string): IntegrationId {
  if (id === "twilio") return "twilio_sms";
  if (id === "sendgrid") return "sendgrid_email";
  return id;
}

export function integrationStatusBadgeClass(status: IntegrationConnectionStatus): string {
  if (status === "Connected") return "bg-success/15 text-success border-success/25";
  if (status === "Attention") return "bg-warning/20 text-warning-foreground border-warning/25";
  return "bg-destructive/15 text-destructive border-destructive/25";
}

export function connectionLabelToStatus(label: IntegrationConnectionStatus): IntegrationStatus {
  if (label === "Connected") return "connected";
  if (label === "Attention") return "error";
  return "disconnected";
}
