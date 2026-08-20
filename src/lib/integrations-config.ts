import { fetchAuthSession } from "aws-amplify/auth";

import { AI_API_KEY_HEADER, DEFAULT_AI_MODEL } from "@/lib/ai-proxy";
import { GEOCODE_API_KEY_HEADER } from "@/lib/geocode-proxy";
import { isDynamoConfigured, isWorkspaceSettingsConfigured } from "@/lib/dynamodb";
import {
  loadLegacyOrgIntegrationsFromProfileTable,
  loadOrgIntegrationsFromDynamo,
  saveOrgIntegrationsToDynamo,
} from "@/lib/org-integrations-store";

export type IntegrationConnectionStatus = "Connected" | "Attention" | "Disconnected";

export type GoogleMapsIntegration = {
  enabled: boolean;
  apiKey: string;
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
};

export type AiIntegration = {
  enabled: boolean;
  /**
   * Write-only. Always empty when read back — the stored key lives in the
   * server-only `secrets` partition and is never returned to the browser.
   * Populate it to save a new key; use `readAiConnectionStatus()` to find out
   * whether one is installed.
   */
  apiKey: string;
  /** OpenAI chat model id (default gpt-4o-mini). */
  model?: string;
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
};

/** What the browser is allowed to know about the stored OpenAI key. */
export type AiConnectionStatus = {
  connected: boolean;
  model: string;
  /** Last four characters — identifies the key without exposing it. */
  last4?: string;
  updatedAt?: string;
};

export type IntegrationsConfig = {
  googleMaps: GoogleMapsIntegration;
  ai: AiIntegration;
};

export type GeocodeProviderId = "google" | "none";

const LEGACY_STORAGE_KEY = "titan-freight:integrations-config";
export const INTEGRATIONS_CONFIG_CHANGED = "titan:integrations-config-changed";

export const INTEGRATIONS_CONFIG_DEFAULTS: IntegrationsConfig = {
  googleMaps: {
    enabled: false,
    apiKey: "",
    lastTestedAt: null,
    lastTestOk: null,
  },
  ai: {
    enabled: false,
    apiKey: "",
    model: DEFAULT_AI_MODEL,
    lastTestedAt: null,
    lastTestOk: null,
  },
};

let memoryCache: IntegrationsConfig | null = null;
let loadPromise: Promise<IntegrationsConfig> | null = null;

/** Cognito bearer for the server settings routes. */
async function getCognitoAuthHeaders(): Promise<Record<string, string>> {
  try {
    const session = await fetchAuthSession();
    const token = session.tokens?.idToken?.toString();
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

function canUseBrowserStorage() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function isGoogleMapsIntegration(value: unknown): value is GoogleMapsIntegration {
  if (!value || typeof value !== "object") return false;
  const v = value as GoogleMapsIntegration;
  return (
    typeof v.enabled === "boolean" &&
    typeof v.apiKey === "string" &&
    (v.lastTestedAt === null || typeof v.lastTestedAt === "string") &&
    (v.lastTestOk === null || typeof v.lastTestOk === "boolean")
  );
}

function isAiIntegration(value: unknown): value is AiIntegration {
  if (!value || typeof value !== "object") return false;
  const v = value as AiIntegration;
  return (
    typeof v.enabled === "boolean" &&
    typeof v.apiKey === "string" &&
    (v.model === undefined || typeof v.model === "string") &&
    (v.lastTestedAt === null || typeof v.lastTestedAt === "string") &&
    (v.lastTestOk === null || typeof v.lastTestOk === "boolean")
  );
}

export function mergeIntegrationsConfig(partial: unknown): IntegrationsConfig {
  const base = INTEGRATIONS_CONFIG_DEFAULTS;
  if (!partial || typeof partial !== "object") return base;
  const raw = partial as Partial<IntegrationsConfig>;
  let googleMaps = isGoogleMapsIntegration(raw.googleMaps)
    ? { ...base.googleMaps, ...raw.googleMaps }
    : base.googleMaps;
  const ai = isAiIntegration(raw.ai) ? { ...base.ai, ...raw.ai } : base.ai;

  if (googleMaps.apiKey.trim() && !googleMaps.enabled) {
    googleMaps = { ...googleMaps, enabled: true };
  }

  // The OpenAI key never enters browser state, even if a legacy row still
  // carries one. Redacted here — the single point every read passes through —
  // so no call site can accidentally surface it.
  return { googleMaps, ai: { ...ai, apiKey: "" } };
}

function readLegacyLocalStorage(): IntegrationsConfig | null {
  if (!canUseBrowserStorage()) return null;
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return null;
    return mergeIntegrationsConfig(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

function clearLegacyLocalStorage() {
  if (!canUseBrowserStorage()) return;
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function applyIntegrationsConfig(config: IntegrationsConfig) {
  memoryCache = mergeIntegrationsConfig(config);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(INTEGRATIONS_CONFIG_CHANGED));
  }
}

export function clearIntegrationsConfigCache() {
  memoryCache = null;
  loadPromise = null;
}

/** In-memory snapshot (load from AWS with `ensureIntegrationsConfigLoaded` first). */
export function readIntegrationsConfig(): IntegrationsConfig {
  return memoryCache ?? INTEGRATIONS_CONFIG_DEFAULTS;
}

export async function loadIntegrationsConfig(): Promise<IntegrationsConfig> {
  if (!isWorkspaceSettingsConfigured()) {
    applyIntegrationsConfig(INTEGRATIONS_CONFIG_DEFAULTS);
    return readIntegrationsConfig();
  }

  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      const { data } = await loadOrgIntegrationsFromDynamo<IntegrationsConfig>();
      if (data) {
        applyIntegrationsConfig(data);
        return readIntegrationsConfig();
      }

      if (isDynamoConfigured()) {
        const { data: profileLegacy } =
          await loadLegacyOrgIntegrationsFromProfileTable<IntegrationsConfig>();
        if (profileLegacy) {
          await saveOrgIntegrationsToDynamo(profileLegacy);
          clearLegacyLocalStorage();
          applyIntegrationsConfig(profileLegacy);
          return readIntegrationsConfig();
        }
      }

      const browserLegacy = readLegacyLocalStorage();
      if (browserLegacy) {
        await saveOrgIntegrationsToDynamo(browserLegacy);
        clearLegacyLocalStorage();
        applyIntegrationsConfig(browserLegacy);
        return readIntegrationsConfig();
      }

      applyIntegrationsConfig(INTEGRATIONS_CONFIG_DEFAULTS);
      return readIntegrationsConfig();
    } catch (error) {
      console.error("[integrations-config] Failed to load workspace settings", error);
      applyIntegrationsConfig(INTEGRATIONS_CONFIG_DEFAULTS);
      return readIntegrationsConfig();
    } finally {
      loadPromise = null;
    }
  })();

  return loadPromise;
}

export async function ensureIntegrationsConfigLoaded(): Promise<IntegrationsConfig> {
  if (memoryCache) return memoryCache;
  return loadIntegrationsConfig();
}

export async function saveIntegrationsConfig(config: IntegrationsConfig): Promise<void> {
  const merged = mergeIntegrationsConfig(config);
  if (!isWorkspaceSettingsConfigured()) {
    throw new Error(
      "Workspace settings table is not configured. Set VITE_WORKSPACE_SETTINGS_TABLE_NAME and VITE_COGNITO_IDENTITY_POOL_ID in .env.",
    );
  }
  await saveOrgIntegrationsToDynamo(merged);
  clearLegacyLocalStorage();
  applyIntegrationsConfig(merged);
}

/** @deprecated Use `saveIntegrationsConfig` — kept for callers that only update memory. */
export function writeIntegrationsConfig(config: IntegrationsConfig) {
  applyIntegrationsConfig(config);
}

export async function patchIntegrationsConfig(patch: {
  googleMaps?: Partial<GoogleMapsIntegration>;
  ai?: Partial<AiIntegration>;
}) {
  const current = readIntegrationsConfig();
  const next: IntegrationsConfig = {
    googleMaps: patch.googleMaps
      ? { ...current.googleMaps, ...patch.googleMaps }
      : current.googleMaps,
    ai: patch.ai ? { ...current.ai, ...patch.ai } : current.ai,
  };
  await saveIntegrationsConfig(next);
}

export function getStoredGeocodeApiKey(): string {
  return readIntegrationsConfig().googleMaps.apiKey.trim();
}

export function isGoogleMapsGeocodingEnabled(): boolean {
  const { googleMaps } = readIntegrationsConfig();
  return googleMaps.enabled && getStoredGeocodeApiKey().length > 0;
}

/** Facility autocomplete and stop geocoding require an explicit Google Maps integration. */
export function isFacilityAddressSearchEnabled(): boolean {
  return isGoogleMapsGeocodingEnabled();
}

export function getActiveGeocodeProvider(): GeocodeProviderId {
  return isFacilityAddressSearchEnabled() ? "google" : "none";
}

export function getActiveGeocodeProviderLabel(): string {
  if (!isFacilityAddressSearchEnabled()) {
    return "Not configured";
  }
  return "Google Maps";
}

export function getGoogleMapsConnectionStatus(): IntegrationConnectionStatus {
  const { googleMaps } = readIntegrationsConfig();
  if (!googleMaps.enabled || !getStoredGeocodeApiKey()) return "Disconnected";
  if (googleMaps.lastTestOk === false) return "Attention";
  if (googleMaps.lastTestOk === true) return "Connected";
  return "Attention";
}

export function formatIntegrationLastSync(iso: string | null): string {
  if (!iso) return "Never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "Never";
  const diffMs = Date.now() - then;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export async function testGoogleMapsIntegration(
  apiKey?: string,
): Promise<{ ok: boolean; message: string }> {
  await ensureIntegrationsConfigLoaded();
  const key = (apiKey ?? "").trim() || getStoredGeocodeApiKey();
  if (!key) {
    return {
      ok: false,
      message: "Enter your Google Maps API key in Settings → Integrations and save.",
    };
  }

  const params = new URLSearchParams({
    q: "Chicago, IL, USA",
    limit: "1",
    provider: "google",
  });
  const url = `/api/geocode/search?${params.toString()}`;

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        [GEOCODE_API_KEY_HEADER]: key,
      },
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      return {
        ok: false,
        message: body?.error ?? `Geocode test failed (HTTP ${response.status}).`,
      };
    }
    const payload = (await response.json()) as unknown;
    if (!Array.isArray(payload) || payload.length === 0) {
      return {
        ok: false,
        message: "No results returned. Check API key restrictions and Geocoding API.",
      };
    }
    return { ok: true, message: "Google Maps geocoding is working." };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Network error during test.",
    };
  }
}

export async function recordGoogleMapsTestResult(ok: boolean) {
  await patchIntegrationsConfig({
    googleMaps: {
      lastTestedAt: new Date().toISOString(),
      lastTestOk: ok,
    },
  });
}

let aiStatusCache: AiConnectionStatus | null = null;
let aiStatusPromise: Promise<AiConnectionStatus> | null = null;

const DISCONNECTED: AiConnectionStatus = { connected: false, model: DEFAULT_AI_MODEL };

/** Last known status. `null` until `ensureAiConnectionStatus` has run. */
export function readAiConnectionStatus(): AiConnectionStatus | null {
  return aiStatusCache;
}

export function clearAiConnectionStatusCache() {
  aiStatusCache = null;
  aiStatusPromise = null;
}

/**
 * Ask the server whether an OpenAI key is installed.
 *
 * Replaces the old `getStoredAiApiKey()` presence check. The browser can no
 * longer see the key, so "is it configured" is a question only the server can
 * answer.
 */
export async function ensureAiConnectionStatus(options?: {
  force?: boolean;
}): Promise<AiConnectionStatus> {
  if (!options?.force && aiStatusCache) return aiStatusCache;
  if (aiStatusPromise) return aiStatusPromise;

  aiStatusPromise = (async () => {
    try {
      const response = await fetch("/api/settings/integrations/status", {
        headers: { Accept: "application/json", ...(await getCognitoAuthHeaders()) },
      });
      if (!response.ok) return DISCONNECTED;
      const body = (await response.json()) as { ai?: Partial<AiConnectionStatus> };
      const status: AiConnectionStatus = {
        connected: Boolean(body.ai?.connected),
        model: body.ai?.model?.trim() || DEFAULT_AI_MODEL,
        last4: body.ai?.last4,
        updatedAt: body.ai?.updatedAt,
      };
      aiStatusCache = status;
      return status;
    } catch {
      // Fail closed: unknown status reads as not configured, so the UI offers
      // setup rather than pretending AI is ready.
      return DISCONNECTED;
    } finally {
      aiStatusPromise = null;
    }
  })();

  return aiStatusPromise;
}

/**
 * @deprecated The browser cannot read the OpenAI key. Use
 * `readAiConnectionStatus()?.connected` or `ensureAiConnectionStatus()`.
 * Retained so stale call sites fail closed instead of type-erroring.
 */
export function getStoredAiApiKey(): string {
  return "";
}

export function isAiKeyConfigured(): boolean {
  return Boolean(aiStatusCache?.connected);
}

export function getStoredAiModel(): string {
  return (
    aiStatusCache?.model?.trim() || readIntegrationsConfig().ai.model?.trim() || DEFAULT_AI_MODEL
  );
}

/** Workspace AI is available anywhere the product needs LLM assistance. */
export function isWorkspaceAiEnabled(): boolean {
  return isAiKeyConfigured();
}

/**
 * Save the OpenAI key through the server. Admin-only, enforced server-side.
 *
 * Omit `apiKey` to change the model without re-entering a key the browser
 * cannot read back.
 */
export async function saveAiIntegration(input: {
  apiKey?: string;
  model?: string;
  enabled?: boolean;
}): Promise<AiConnectionStatus> {
  const response = await fetch("/api/settings/integrations/ai", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(await getCognitoAuthHeaders()),
    },
    body: JSON.stringify(input),
  });

  const body = (await response.json().catch(() => null)) as {
    ai?: Partial<AiConnectionStatus>;
    error?: string;
  } | null;

  if (!response.ok) {
    throw new Error(body?.error ?? `Could not save the AI integration (HTTP ${response.status}).`);
  }

  const status: AiConnectionStatus = {
    connected: Boolean(body?.ai?.connected),
    model: body?.ai?.model?.trim() || DEFAULT_AI_MODEL,
    last4: body?.ai?.last4,
    updatedAt: body?.ai?.updatedAt,
  };
  aiStatusCache = status;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(INTEGRATIONS_CONFIG_CHANGED));
  }
  return status;
}

export function isAiBiddingCopilotEnabled(): boolean {
  return isWorkspaceAiEnabled();
}

export function getAiConnectionStatus(): IntegrationConnectionStatus {
  // Connectedness is the server's answer, not a local key check — the browser
  // cannot see the key any more, so `getStoredAiApiKey()` is always empty and
  // using it here pinned this to "Disconnected" forever.
  if (!isAiKeyConfigured()) return "Disconnected";
  const { ai } = readIntegrationsConfig();
  if (ai.lastTestOk === false) return "Attention";
  if (ai.lastTestOk === true) return "Connected";
  return "Connected";
}

export async function testAiIntegration(
  apiKey?: string,
): Promise<{ ok: boolean; message: string }> {
  await ensureIntegrationsConfigLoaded();
  // A draft key (typed but not yet saved) is tested directly. With no draft the
  // server tests the stored key — which the browser cannot read, so it cannot
  // send it. That is the normal path once a key has been saved.
  const draftKey = (apiKey ?? "").trim();
  if (!draftKey && !isAiKeyConfigured()) {
    return {
      ok: false,
      message: "Enter your OpenAI API key in Settings → Integrations and save.",
    };
  }

  try {
    const response = await fetch("/api/ai/test", {
      method: "POST",
      headers: {
        Accept: "application/json",
        // The endpoint is authenticated and role-gated now — without this it
        // answers 401 regardless of the key.
        ...(await getCognitoAuthHeaders()),
        ...(draftKey ? { [AI_API_KEY_HEADER]: draftKey } : {}),
      },
    });
    const body = (await response.json().catch(() => null)) as {
      ok?: boolean;
      message?: string;
      error?: string;
    } | null;

    if (!response.ok) {
      return {
        ok: false,
        message: body?.error ?? `OpenAI test failed (HTTP ${response.status}).`,
      };
    }

    return {
      ok: true,
      message: body?.message ?? "OpenAI API key is valid.",
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Network error during OpenAI test.",
    };
  }
}

export async function recordAiTestResult(ok: boolean) {
  await patchIntegrationsConfig({
    ai: {
      lastTestedAt: new Date().toISOString(),
      lastTestOk: ok,
    },
  });
}
