import type { AppSettingValue } from "@/lib/app-settings-store";
import {
  formatIntegrationLastSync,
  getAiConnectionStatus,
  getGoogleMapsConnectionStatus,
  readAiConnectionStatus,
  getStoredGeocodeApiKey,
  readIntegrationsConfig,
  type IntegrationConnectionStatus,
} from "@/lib/integrations-config";

import {
  connectionLabelToStatus,
  INTEGRATION_PROVIDERS,
  type IntegrationId,
  type IntegrationState,
} from "./types";

function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 4) return "••••";
  return `+• ••• ••• ${digits.slice(-4)}`;
}

function maskKey(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.includes("****")) return trimmed;
  if (trimmed.length <= 4) return "••••";
  return `•••• ••••${trimmed.slice(-4)}`;
}

export function resolveIntegrationState(
  id: IntegrationId,
  settingsValues: Record<string, AppSettingValue>,
): IntegrationState {
  const name = INTEGRATION_PROVIDERS.find((p) => p.id === id)?.label ?? String(id);

  if (id === "google_maps") {
    const { googleMaps } = readIntegrationsConfig();
    const connectionLabel = getGoogleMapsConnectionStatus();
    const key = getStoredGeocodeApiKey();
    return {
      id,
      name,
      status: connectionLabelToStatus(connectionLabel),
      connectionLabel,
      lastSyncAt: googleMaps.lastTestedAt,
      lastSyncLabel: formatIntegrationLastSync(googleMaps.lastTestedAt),
      maskedConfig: key ? { apiKey: maskKey(key) } : {},
      capabilities: googleMaps.enabled && key ? ["maps.geocode", "maps.directions"] : [],
    };
  }

  if (id === "ai") {
    const { ai } = readIntegrationsConfig();
    const connectionLabel = getAiConnectionStatus();
    // The key itself never reaches the browser — the server hands back only the
    // last four characters, which is all a masked display ever needed.
    const status = readAiConnectionStatus();
    const connected = Boolean(status?.connected);
    return {
      id,
      name,
      status: connectionLabelToStatus(connectionLabel),
      connectionLabel,
      lastSyncAt: ai.lastTestedAt,
      lastSyncLabel: formatIntegrationLastSync(ai.lastTestedAt),
      maskedConfig: status?.last4 ? { apiKey: `****${status.last4}` } : {},
      capabilities: connected ? ["ai.chat", "ai.translate", "ai.draft"] : [],
    };
  }

  if (id === "dat") {
    const key = String(settingsValues.dat_api_key ?? "").trim();
    const connected = key.length > 0 && !key.includes("****");
    const connectionLabel: IntegrationConnectionStatus = connected ? "Connected" : "Disconnected";
    return {
      id,
      name,
      status: connectionLabelToStatus(connectionLabel),
      connectionLabel,
      lastSyncAt: null,
      lastSyncLabel: connected ? "—" : "Never",
      maskedConfig: key ? { apiKey: maskKey(key) } : {},
      capabilities: connected ? ["dat.rates", "dat.capacity"] : [],
    };
  }

  if (id === "twilio_sms") {
    const on = settingsValues.twilio_sms_enabled === true;
    const fromNumber = String(settingsValues.sms_sender_number ?? "").trim();
    const connectionLabel: IntegrationConnectionStatus = on ? "Connected" : "Disconnected";
    return {
      id,
      name,
      status: connectionLabelToStatus(connectionLabel),
      connectionLabel,
      lastSyncAt: null,
      lastSyncLabel: on ? "—" : "Never",
      maskedConfig: fromNumber ? { fromNumber: maskPhone(fromNumber) } : {},
      capabilities: on
        ? ["sms.send", "sms.receive", "sms.status-callback", "voice.call", "voice.recording"]
        : [],
    };
  }

  if (id === "sendgrid_email") {
    const on = settingsValues.sendgrid_email_enabled === true;
    const fromEmail = String(settingsValues.default_sender_email ?? "").trim();
    const connectionLabel: IntegrationConnectionStatus = on ? "Connected" : "Disconnected";
    return {
      id,
      name,
      status: connectionLabelToStatus(connectionLabel),
      connectionLabel,
      lastSyncAt: null,
      lastSyncLabel: on ? "—" : "Never",
      maskedConfig: fromEmail
        ? { fromEmail: fromEmail.replace(/^(.{2}).*(@.*)$/, "$1••••$2") }
        : {},
      capabilities: on ? ["email.send", "email.receive"] : [],
    };
  }

  if (id === "quickbooks") {
    const on = settingsValues.quickbooks_integration_enabled === true;
    const connectionLabel: IntegrationConnectionStatus = on ? "Attention" : "Disconnected";
    return {
      id,
      name,
      status: connectionLabelToStatus(connectionLabel),
      connectionLabel,
      lastSyncAt: null,
      lastSyncLabel: on ? "—" : "Never",
      maskedConfig: {},
      capabilities: on ? ["accounting.sync"] : [],
    };
  }

  return {
    id,
    name,
    status: "disconnected",
    connectionLabel: "Disconnected",
    lastSyncAt: null,
    lastSyncLabel: "Never",
    maskedConfig: {},
    capabilities: [],
  };
}
