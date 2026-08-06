import * as React from "react";

import {
  loadAppSettingsFromDynamo,
  saveAppSettingsToDynamo,
  type AppSettingValue,
} from "@/lib/app-settings-store";
import { useAuth } from "@/lib/auth";
import { isWorkspaceSettingsConfigured } from "@/lib/dynamodb";

function formatLastSavedLabel(iso: string | null) {
  if (!iso) return "Never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "Never";
  const diffMs = Date.now() - then;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} hr ago`;
  return new Date(iso).toLocaleString();
}

export function useAppSettings(defaults: Record<string, AppSettingValue>) {
  const { user, status } = useAuth();
  const workspaceReady =
    isWorkspaceSettingsConfigured() && status === "authenticated" && Boolean(user?.userId);

  const defaultsRef = React.useRef(defaults);
  defaultsRef.current = defaults;

  const [values, setValues] = React.useState<Record<string, AppSettingValue>>(defaults);
  const [savedValues, setSavedValues] = React.useState<Record<string, AppSettingValue>>(defaults);
  const [lastSavedAt, setLastSavedAt] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(workspaceReady);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!workspaceReady) {
      setLoading(false);
      setValues(defaultsRef.current);
      setSavedValues(defaultsRef.current);
      setLastSavedAt(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void loadAppSettingsFromDynamo(defaultsRef.current)
      .then(({ settings, updatedAt }) => {
        if (cancelled) return;
        setValues(settings);
        setSavedValues(settings);
        setLastSavedAt(updatedAt);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load settings");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [workspaceReady, user?.userId]);

  const dirty = React.useMemo(
    () => Object.keys(values).some((key) => (values[key] ?? "") !== (savedValues[key] ?? "")),
    [values, savedValues],
  );

  const save = React.useCallback(
    async (next: Record<string, AppSettingValue>) => {
      if (!workspaceReady) {
        throw new Error(
          "Workspace settings table is not configured. Set VITE_WORKSPACE_SETTINGS_TABLE_NAME and VITE_COGNITO_IDENTITY_POOL_ID in .env.",
        );
      }
      setSaving(true);
      setError(null);
      try {
        await saveAppSettingsToDynamo(next);
        setSavedValues(next);
        const savedAt = new Date().toISOString();
        setLastSavedAt(savedAt);
        return savedAt;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to save settings";
        setError(message);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [workspaceReady],
  );

  const resetToSaved = React.useCallback(() => {
    setValues(savedValues);
  }, [savedValues]);

  const resetToDefaults = React.useCallback(() => {
    setValues(defaultsRef.current);
  }, []);

  return {
    values,
    setValues,
    savedValues,
    loading,
    saving,
    save,
    error,
    dirty,
    workspaceReady,
    lastSavedLabel: formatLastSavedLabel(lastSavedAt),
    resetToSaved,
    resetToDefaults,
  };
}
