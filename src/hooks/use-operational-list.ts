import * as React from "react";

export type OperationalFetchMode = "initial" | "refresh";

export type UseOperationalListOptions<T> = {
  /** Identity for the list (included in the effect deps so scope changes re-fetch). */
  queryKey: readonly unknown[];
  /** Fetch the list. `force` is true on refresh (e.g. bypass TTL cache). */
  fetchList: (opts: { force: boolean }) => Promise<T[]>;
  /** When false, skip the initial fetch (e.g. detail sub-routes). Default true. */
  enabled?: boolean;
  /** Fallback error message when the thrown value is not an Error. */
  errorMessage?: string;
};

export type UseOperationalListResult<T> = {
  items: T[] | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  setItems: React.Dispatch<React.SetStateAction<T[] | null>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  /** Re-run as initial load (sets `loading`). */
  reload: () => Promise<void>;
  /** Re-run as force refresh (sets `refreshing`). */
  refresh: () => Promise<void>;
};

/**
 * Shared list-fetch state matching the hand-rolled loads/carriers pattern:
 * `loading` on first load, `refreshing` on force refresh, `error` as string | null.
 */
export function useOperationalList<T>({
  queryKey,
  fetchList,
  enabled = true,
  errorMessage = "Failed to load.",
}: UseOperationalListOptions<T>): UseOperationalListResult<T> {
  const [items, setItems] = React.useState<T[] | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const fetchListRef = React.useRef(fetchList);
  fetchListRef.current = fetchList;

  const run = React.useCallback(async (mode: OperationalFetchMode) => {
    if (mode === "initial") setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const next = await fetchListRef.current({ force: mode === "refresh" });
      setItems(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : errorMessage);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [errorMessage]);

  const queryKeySerialized = JSON.stringify(queryKey);

  React.useEffect(() => {
    if (!enabled) return;
    void run("initial");
    // queryKeySerialized mirrors queryKey for stable dep comparison
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional key serialization
  }, [enabled, run, queryKeySerialized]);

  const reload = React.useCallback(() => run("initial"), [run]);
  const refresh = React.useCallback(() => run("refresh"), [run]);

  return {
    items,
    loading,
    refreshing,
    error,
    setItems,
    setError,
    reload,
    refresh,
  };
}

/**
 * Thin alias for non-list fetches that still need initial/refresh loading flags.
 * Callers typically keep a separate typed `data` field via `items` (single-element or mapped).
 */
export function useRefreshableQuery<T>(
  options: UseOperationalListOptions<T>,
): UseOperationalListResult<T> {
  return useOperationalList(options);
}
