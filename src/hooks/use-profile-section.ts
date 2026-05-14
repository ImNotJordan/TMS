import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/lib/auth";
import { isDynamoConfigured } from "@/lib/dynamodb";
import { getSection, putSection, type SectionKey } from "@/lib/profile-store";

export type UseProfileSection<T> = {
  data: T;
  setData: React.Dispatch<React.SetStateAction<T>>;
  patch: (partial: Partial<T>) => void;
  save: () => Promise<void>;
  reset: () => void;
  dirty: boolean;
  loading: boolean;
  saving: boolean;
  error: string | null;
  enabled: boolean;
};

export function useProfileSection<T extends Record<string, unknown>>(
  section: SectionKey,
  defaults: T,
): UseProfileSection<T> {
  const { user } = useAuth();
  const userId = user?.userId;
  const enabled = isDynamoConfigured() && Boolean(userId);

  const defaultsRef = useRef(defaults);

  const [data, setData] = useState<T>(defaults);
  const [initial, setInitial] = useState<T>(defaults);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !userId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getSection<Partial<T>>(userId, section)
      .then((loaded) => {
        if (cancelled) return;
        const merged = { ...defaultsRef.current, ...(loaded ?? {}) } as T;
        setData(merged);
        setInitial(merged);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, userId, section]);

  const save = useCallback(async () => {
    if (!enabled || !userId) {
      throw new Error(
        "DynamoDB is not configured. Set VITE_AWS_REGION, VITE_PROFILE_TABLE_NAME, and VITE_COGNITO_IDENTITY_POOL_ID in your .env.",
      );
    }
    setSaving(true);
    setError(null);
    try {
      await putSection(userId, section, data);
      setInitial(data);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Save failed";
      setError(message);
      throw e;
    } finally {
      setSaving(false);
    }
  }, [enabled, userId, section, data]);

  const reset = useCallback(() => setData(initial), [initial]);

  const patch = useCallback(
    (partial: Partial<T>) => setData((prev) => ({ ...prev, ...partial })),
    [],
  );

  const dirty = useMemo(() => JSON.stringify(data) !== JSON.stringify(initial), [data, initial]);

  return { data, setData, patch, save, reset, dirty, loading, saving, error, enabled };
}
