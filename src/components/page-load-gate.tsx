import * as React from "react";
import { useRouterState } from "@tanstack/react-router";

type PageLoadContextValue = {
  /** Report whether a page (or section) is still loading data. */
  report: (key: string, loading: boolean) => void;
};

const PageLoadContext = React.createContext<PageLoadContextValue | null>(null);

/**
 * Tracks per-route data readiness. On every pathname change the gate resets;
 * pages call `usePageReady(loading)` so the shell can keep the route skeleton up
 * until fetches finish and the UI can paint.
 */
export function PageLoadProvider({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [loadingKeys, setLoadingKeys] = React.useState<Set<string>>(() => new Set());
  const [generation, setGeneration] = React.useState(0);
  const [awaitingReporter, setAwaitingReporter] = React.useState(true);
  const generationRef = React.useRef(0);

  React.useEffect(() => {
    generationRef.current += 1;
    setGeneration(generationRef.current);
    setLoadingKeys(new Set());
    setAwaitingReporter(true);
    const timer = window.setTimeout(() => {
      // Static pages with no usePageReady() become ready after a short grace window.
      setAwaitingReporter(false);
    }, 80);
    return () => window.clearTimeout(timer);
  }, [pathname]);

  const report = React.useCallback((key: string, loading: boolean) => {
    setAwaitingReporter(false);
    setLoadingKeys((prev) => {
      const next = new Set(prev);
      if (loading) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  const value = React.useMemo(() => ({ report }), [report]);
  const dataBusy = awaitingReporter || loadingKeys.size > 0;

  return (
    <PageLoadContext.Provider value={value}>
      <PageLoadBusyContext.Provider value={dataBusy}>
        <PageLoadGenerationContext.Provider value={generation}>
          {children}
        </PageLoadGenerationContext.Provider>
      </PageLoadBusyContext.Provider>
    </PageLoadContext.Provider>
  );
}

const PageLoadBusyContext = React.createContext(false);
const PageLoadGenerationContext = React.createContext(0);

export function usePageLoadBusy() {
  return React.useContext(PageLoadBusyContext);
}

/**
 * Call from any route that fetches data. Pass `true` while loading;
 * the shell skeleton stays up until every registered key reports ready.
 */
export function usePageReady(loading: boolean, key = "page") {
  const ctx = React.useContext(PageLoadContext);
  const generation = React.useContext(PageLoadGenerationContext);

  React.useEffect(() => {
    if (!ctx) return;
    ctx.report(key, loading);
    return () => ctx.report(key, false);
  }, [ctx, key, loading, generation]);
}
