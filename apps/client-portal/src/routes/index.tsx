import { useCallback, useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";

import { ClientShell } from "@/components/dashboard/client-shell";
import { KpiStrip } from "@/components/dashboard/kpi-strip";
import { LoadRail } from "@/components/dashboard/load-rail";
import { TaxOverview } from "@/components/dashboard/tax-overview";
import { TrackingMap } from "@/components/dashboard/tracking-map";
import { DashboardSkeleton } from "@/components/page-skeletons";
import { apiGetClientDashboard, ClientDashboardApiError } from "@/lib/dashboard-api";
import type { ClientDashboardResponse } from "@/lib/dashboard-types";

export const Route = createFileRoute("/")({
  component: DashboardPage,
});

const POLL_MS = 20_000;

function DashboardPage() {
  const [data, setData] = useState<ClientDashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const refresh = useCallback(async (silent = false) => {
    try {
      const next = await apiGetClientDashboard();
      setData(next);
      setError(null);
      setSelectedId((current) => {
        if (current && next.loads.some((load) => load.loadId === current)) return current;
        return next.loads[0]?.loadId ?? null;
      });
    } catch (err) {
      const message =
        err instanceof ClientDashboardApiError ? err.message : "Could not load your shipments.";
      setError(message);
      if (!silent) toast.error(message);
    }
  }, []);

  useEffect(() => {
    document.title = "Shipments — Titan Freight Client";
    void refresh();
    const id = window.setInterval(() => void refresh(true), POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  if (!data && !error) {
    return (
      <ClientShell>
        <DashboardSkeleton />
      </ClientShell>
    );
  }

  if (error && !data) {
    return (
      <ClientShell>
        <div className="flex h-full items-center justify-center px-6 text-center">
          <div>
            <h1 className="text-lg font-semibold">Couldn’t load shipments</h1>
            <p className="mt-2 max-w-sm text-sm text-muted-foreground">{error}</p>
            <button
              type="button"
              className="mt-4 cursor-pointer text-sm font-semibold text-sky hover:underline"
              onClick={() => void refresh()}
            >
              Try again
            </button>
          </div>
        </div>
      </ClientShell>
    );
  }

  if (!data) return null;

  return (
    <ClientShell companyName={data.companyName}>
      <div className="flex h-full min-h-0 flex-col lg:flex-row">
        <section className="relative min-h-[42vh] flex-1 lg:min-h-0">
          <TrackingMap
            loads={data.loads}
            selectedId={selectedId}
            onSelect={setSelectedId}
            mapsApiKey={data.maps?.apiKey}
          />
        </section>
        <aside className="flex w-full min-h-0 shrink-0 flex-col gap-3 overflow-y-auto border-t border-border bg-background/95 p-4 lg:w-[400px] lg:border-t-0 lg:border-l">
          <KpiStrip summary={data.summary} />
          <TaxOverview summary={data.summary} loads={data.loads} />
          <div>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Active loads
            </h2>
            <LoadRail loads={data.loads} selectedId={selectedId} onSelect={setSelectedId} />
          </div>
        </aside>
      </div>
    </ClientShell>
  );
}
