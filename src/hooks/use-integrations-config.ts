import * as React from "react";

import { useAuth } from "@/lib/auth";
import { isWorkspaceSettingsConfigured } from "@/lib/dynamodb";
import {
  INTEGRATIONS_CONFIG_CHANGED,
  INTEGRATIONS_CONFIG_DEFAULTS,
  loadIntegrationsConfig,
  readIntegrationsConfig,
  saveIntegrationsConfig,
  type IntegrationsConfig,
} from "@/lib/integrations-config";

export function useIntegrationsConfig() {
  const { user, status } = useAuth();
  const enabled =
    isWorkspaceSettingsConfigured() && status === "authenticated" && Boolean(user?.userId);

  const [config, setConfig] = React.useState<IntegrationsConfig>(INTEGRATIONS_CONFIG_DEFAULTS);
  const [loading, setLoading] = React.useState(enabled);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const syncFromCache = React.useCallback(() => {
    setConfig(readIntegrationsConfig());
  }, []);

  React.useEffect(() => {
    if (!enabled) {
      setLoading(false);
      setConfig(INTEGRATIONS_CONFIG_DEFAULTS);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void loadIntegrationsConfig()
      .then((loaded) => {
        if (!cancelled) setConfig(loaded);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load integrations");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    window.addEventListener(INTEGRATIONS_CONFIG_CHANGED, syncFromCache);
    return () => {
      cancelled = true;
      window.removeEventListener(INTEGRATIONS_CONFIG_CHANGED, syncFromCache);
    };
  }, [enabled, syncFromCache, user?.userId]);

  const save = React.useCallback(
    async (next: IntegrationsConfig) => {
      if (!enabled) {
        throw new Error(
          "Workspace settings table is not configured. Set VITE_WORKSPACE_SETTINGS_TABLE_NAME and VITE_COGNITO_IDENTITY_POOL_ID in .env.",
        );
      }
      setSaving(true);
      setError(null);
      try {
        await saveIntegrationsConfig(next);
        setConfig(readIntegrationsConfig());
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to save integrations";
        setError(message);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [enabled],
  );

  return { config, save, loading, saving, error, enabled };
}
