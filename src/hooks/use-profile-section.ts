import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/lib/auth";
import { isDynamoConfigured } from "@/lib/dynamodb";
import {
  clearProfileSectionCache,
  fetchProfileSectionDeduped,
  isProfileSectionCacheFresh,
  mergeProfileDefaults,
  readProfileSectionCache,
  writeProfileSectionCache,
} from "@/lib/profile-section-cache";
import { getSection, putSection, putSectionMerge, type SectionKey } from "@/lib/profile-store";

export type UseProfileSection<T> = {
  data: T;
  setData: React.Dispatch<React.SetStateAction<T>>;
  patch: (partial: Partial<T>) => void;
  save: () => Promise<void>;
  reset: () => void;
  refresh: () => Promise<void>;
  dirty: boolean;
  loading: boolean;
  saving: boolean;
  error: string | null;
  enabled: boolean;
};

function serverPayload<T extends Record<string, unknown>>(data: T): Record<string, unknown> {
  return data as Record<string, unknown>;
}

export function useProfileSection<T extends Record<string, unknown>>(
  section: SectionKey,
  defaults: T,
  options?: {
    /**
     * Merge the form payload into the existing Dynamo section document.
     * Required for Profile → Permissions so modulePermissions matrices are not wiped.
     */
    mergeOnSave?: boolean;
  },
): UseProfileSection<T> {
  const mergeOnSave = Boolean(options?.mergeOnSave);
  const { user } = useAuth();
  const userId = user?.userId;
  const enabled = isDynamoConfigured() && Boolean(userId);

  const defaultsRef = useRef(defaults);
  defaultsRef.current = defaults;

  const cachedEntry = enabled && userId ? readProfileSectionCache(userId, section) : undefined;
  const cachedMerged = cachedEntry
    ? mergeProfileDefaults(defaultsRef.current, cachedEntry.server)
    : defaultsRef.current;

  const [data, setData] = useState<T>(cachedMerged);
  const [initial, setInitial] = useState<T>(cachedMerged);
  const [loading, setLoading] = useState(() => enabled && !cachedEntry);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyFromServer = useCallback(
    (server: Record<string, unknown> | null, updatedAt: string) => {
      if (!userId) return;
      const merged = mergeProfileDefaults(defaultsRef.current, server);
      writeProfileSectionCache(userId, section, server, updatedAt);
      setData(merged);
      setInitial(merged);
    },
    [section, userId],
  );

  const loadFromRemote = useCallback(
    async (options?: { force?: boolean }) => {
      if (!enabled || !userId) return;

      const cached = readProfileSectionCache(userId, section);
      if (cached && !options?.force) {
        const merged = mergeProfileDefaults(defaultsRef.current, cached.server);
        setData(merged);
        setInitial(merged);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const { server, updatedAt } = await fetchProfileSectionDeduped<T>(userId, section, () =>
          getSection<Partial<T>>(userId, section),
        );

        if (!options?.force && cached && isProfileSectionCacheFresh(cached, updatedAt)) {
          const merged = mergeProfileDefaults(defaultsRef.current, cached.server);
          setData(merged);
          setInitial(merged);
          return;
        }

        applyFromServer(server, updatedAt ?? new Date().toISOString());
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    },
    [applyFromServer, enabled, section, userId],
  );

  useEffect(() => {
    if (!enabled || !userId) {
      setLoading(false);
      return;
    }

    const cached = readProfileSectionCache(userId, section);
    if (cached) {
      const merged = mergeProfileDefaults(defaultsRef.current, cached.server);
      setData(merged);
      setInitial(merged);
      setLoading(false);
      return;
    }

    void loadFromRemote();
    // Only re-run when identity or section changes — not when defaults object identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      const payload = serverPayload(data);
      if (mergeOnSave) {
        const merged = await putSectionMerge(userId, section, payload);
        const updatedAt = new Date().toISOString();
        writeProfileSectionCache(userId, section, merged, updatedAt);
        const next = mergeProfileDefaults(defaultsRef.current, merged);
        setData(next);
        setInitial(next);
      } else {
        await putSection(userId, section, data);
        const updatedAt = new Date().toISOString();
        writeProfileSectionCache(userId, section, payload, updatedAt);
        setInitial(data);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Save failed";
      setError(message);
      throw e;
    } finally {
      setSaving(false);
    }
  }, [enabled, userId, section, data, mergeOnSave]);

  const reset = useCallback(() => setData(initial), [initial]);

  const refresh = useCallback(async () => {
    await loadFromRemote({ force: true });
  }, [loadFromRemote]);

  const patch = useCallback(
    (partial: Partial<T>) => setData((prev) => ({ ...prev, ...partial })),
    [],
  );

  const dirty = useMemo(() => JSON.stringify(data) !== JSON.stringify(initial), [data, initial]);

  return { data, setData, patch, save, reset, refresh, dirty, loading, saving, error, enabled };
}

/** Call on sign-out so the next user does not see cached profile data. */
export { clearProfileSectionCache };
