import * as React from "react";
import { toast } from "sonner";

import {
  APP_SETTINGS_CHANGED,
  loadAppSettingsFromDynamo,
  type AppSettingValue,
} from "@/lib/app-settings-store";
import { useAuth } from "@/lib/auth";
import { isWorkspaceSettingsConfigured } from "@/lib/dynamodb";
import {
  INTEGRATIONS_CONFIG_CHANGED,
  readAiConnectionStatus,
  getStoredGeocodeApiKey,
  loadIntegrationsConfig,
  recordAiTestResult,
  recordGoogleMapsTestResult,
  testAiIntegration,
  testGoogleMapsIntegration,
} from "@/lib/integrations-config";

import { resolveIntegrationState } from "./resolveIntegration";
import {
  INTEGRATION_PROVIDERS,
  toCanonicalIntegrationId,
  type IntegrationId,
  type IntegrationState,
  type TestResult,
} from "./types";

/** Subset of DEFAULT_SETTINGS keys needed to resolve connection status. */
const INTEGRATION_SETTINGS_DEFAULTS: Record<string, AppSettingValue> = {
  dat_api_key: "",
  twilio_sms_enabled: false,
  sendgrid_email_enabled: false,
  quickbooks_integration_enabled: false,
  default_sender_email: "",
  sms_sender_number: "",
};

export function useIntegrations(settingsOverride?: Record<string, AppSettingValue>) {
  const { user, status } = useAuth();
  const enabled =
    isWorkspaceSettingsConfigured() && status === "authenticated" && Boolean(user?.userId);

  const [settingsValues, setSettingsValues] = React.useState<Record<string, AppSettingValue>>(
    settingsOverride ?? INTEGRATION_SETTINGS_DEFAULTS,
  );
  const [isLoading, setIsLoading] = React.useState(enabled && !settingsOverride);
  const [testingId, setTestingId] = React.useState<IntegrationId | null>(null);
  const [tick, setTick] = React.useState(0);

  const refresh = React.useCallback(() => {
    setTick((n) => n + 1);
  }, []);

  React.useEffect(() => {
    if (settingsOverride) {
      setSettingsValues(settingsOverride);
      setIsLoading(false);
      return;
    }
    if (!enabled) {
      setSettingsValues(INTEGRATION_SETTINGS_DEFAULTS);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    void Promise.all([
      loadAppSettingsFromDynamo(INTEGRATION_SETTINGS_DEFAULTS),
      loadIntegrationsConfig(),
    ])
      .then(([loaded]) => {
        if (!cancelled) setSettingsValues(loaded.settings);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    const onChange = () => {
      void loadAppSettingsFromDynamo(INTEGRATION_SETTINGS_DEFAULTS).then((loaded) => {
        if (!cancelled) setSettingsValues(loaded.settings);
      });
      refresh();
    };

    window.addEventListener(APP_SETTINGS_CHANGED, onChange);
    window.addEventListener(INTEGRATIONS_CONFIG_CHANGED, onChange);
    return () => {
      cancelled = true;
      window.removeEventListener(APP_SETTINGS_CHANGED, onChange);
      window.removeEventListener(INTEGRATIONS_CONFIG_CHANGED, onChange);
    };
  }, [enabled, settingsOverride, refresh, user?.userId]);

  // Re-resolve when integrations config changes (Maps/AI lastTest).
  React.useEffect(() => {
    const onIntegrations = () => refresh();
    window.addEventListener(INTEGRATIONS_CONFIG_CHANGED, onIntegrations);
    return () => window.removeEventListener(INTEGRATIONS_CONFIG_CHANGED, onIntegrations);
  }, [refresh]);

  const items = React.useMemo(() => {
    void tick;
    return INTEGRATION_PROVIDERS.map((p) => resolveIntegrationState(p.id, settingsValues));
  }, [settingsValues, tick]);

  const byId = React.useMemo(() => {
    const map = new Map<string, IntegrationState>();
    for (const item of items) map.set(item.id, item);
    return map;
  }, [items]);

  const test = React.useCallback(
    async (rawId: string): Promise<TestResult> => {
      const id = toCanonicalIntegrationId(rawId);
      setTestingId(id);
      try {
        if (id === "google_maps") {
          const result = await testGoogleMapsIntegration();
          await recordGoogleMapsTestResult(result.ok);
          refresh();
          return result;
        }
        if (id === "ai") {
          const result = await testAiIntegration();
          await recordAiTestResult(result.ok);
          refresh();
          return result;
        }
        const label = INTEGRATION_PROVIDERS.find((p) => p.id === id)?.label ?? id;
        return { ok: false, message: `Test for ${label} is not wired yet.` };
      } finally {
        setTestingId(null);
      }
    },
    [refresh],
  );

  const canTest = React.useCallback((rawId: string) => {
    const id = toCanonicalIntegrationId(rawId);
    if (id === "google_maps") return Boolean(getStoredGeocodeApiKey());
    if (id === "ai") return Boolean(readAiConnectionStatus()?.connected);
    return true;
  }, []);

  return {
    data: items,
    byId,
    isLoading,
    testingId,
    refetch: refresh,
    test,
    canTest,
    settingsValues,
  };
}

export function useIntegration(id: string) {
  const canonical = toCanonicalIntegrationId(id);
  const { byId, isLoading, testingId, refetch, test, canTest } = useIntegrations();

  const data = byId.get(canonical);

  return {
    data,
    isLoading,
    testing: testingId === canonical,
    canTest: canTest(canonical),
    refetch,
    test: () => test(canonical),
  };
}

/** Toast-friendly test used by Settings panel. */
export async function runIntegrationTestWithToast(
  testFn: (id: string) => Promise<TestResult>,
  id: string,
) {
  const result = await testFn(id);
  if (result.ok) toast.success(result.message);
  else if (result.message.includes("not wired")) toast.message(result.message);
  else toast.error(result.message);
  return result;
}
