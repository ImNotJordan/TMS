import * as React from "react";
import { useQuery } from "@tanstack/react-query";

import {
  ANALYTICS_QUERY_KEY,
  fetchAnalyticsBundle,
  filterEventsByPeriod,
  type AnalyticsEvent,
  type AnalyticsPeriod,
} from "@/lib/analytics-events";
import {
  computeAnalyticsSnapshot,
  eventsForKpi,
  type AnalyticsKpi,
  type AnalyticsSnapshot,
} from "@/lib/analytics-kpis";
import { useAuth } from "@/lib/auth";

export const ANALYTICS_PERIODS: { value: AnalyticsPeriod; label: string }[] = [
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "90d", label: "90D" },
  { value: "ytd", label: "YTD" },
];

export function useAnalytics(period: AnalyticsPeriod) {
  const { user } = useAuth();
  const workspaceId = user?.userId ?? "_";

  const query = useQuery({
    queryKey: [...ANALYTICS_QUERY_KEY, workspaceId],
    queryFn: () => fetchAnalyticsBundle(workspaceId),
    refetchInterval: 90_000,
    refetchIntervalInBackground: false,
    staleTime: 30_000,
  });

  const snapshot: AnalyticsSnapshot | null = React.useMemo(() => {
    if (!query.data) return null;
    return computeAnalyticsSnapshot(query.data.events, period);
  }, [query.data, period]);

  const periodEvents: AnalyticsEvent[] = React.useMemo(() => {
    if (!query.data) return [];
    return filterEventsByPeriod(query.data.events, period);
  }, [query.data, period]);

  const drillEventsForKpi = React.useCallback(
    (kpi: AnalyticsKpi) => eventsForKpi(periodEvents, kpi),
    [periodEvents],
  );

  const drillEventsByIds = React.useCallback(
    (ids: string[]) => {
      const set = new Set(ids);
      return periodEvents.filter((e) => set.has(e.id));
    },
    [periodEvents],
  );

  return {
    ...query,
    workspaceId,
    snapshot,
    periodEvents,
    drillEventsForKpi,
    drillEventsByIds,
    eventCount: periodEvents.length,
    builtAt: query.data?.builtAt,
    sourceErrors: query.data?.errors ?? [],
  };
}
