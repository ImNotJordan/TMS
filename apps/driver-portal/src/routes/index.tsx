import { useEffect } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Package, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ActiveLoadCard } from "@/components/home/active-load-card";
import { QuickStats } from "@/components/home/quick-stats";
import { LocationShareCard } from "@/components/home/location-share-card";
import { LoadOfferCard } from "@/components/loads/load-offer-card";
import { useLoads } from "@/lib/loads-store";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  useEffect(() => {
    document.title = "Home — Titan Freight Driver";
  }, []);

  const {
    activeLoad,
    offeredLoads,
    myLoads,
    activity,
    acceptLoad,
    declineLoad,
    error,
    refresh,
    refreshing,
  } = useLoads();

  const deliveredCount = myLoads.filter((l) => l.status === "delivered").length;
  const milesProxy = myLoads.reduce((sum, l) => sum + (l.distanceMiles || 0), 0);

  return (
    <div className="space-y-5 px-4 py-5">
      {error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          <div className="font-medium">Couldn’t sync with AWS</div>
          <p className="mt-1 opacity-90">{error}</p>
          <Button
            size="sm"
            variant="outline"
            className="mt-2 h-8 gap-1.5"
            onClick={() => void refresh()}
            disabled={refreshing}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Retry
          </Button>
        </div>
      ) : null}

      {activeLoad ? (
        <ActiveLoadCard load={activeLoad} />
      ) : (
        <div className="rounded-2xl border border-dashed border-border p-6 text-center">
          <Package className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-2 text-sm font-medium text-foreground">No active load</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Browse available loads and accept one to get rolling.
          </p>
          <Button asChild className="mt-4" size="sm">
            <Link to="/loads">Browse loads</Link>
          </Button>
        </div>
      )}

      <QuickStats
        milesToday={milesProxy}
        activeCount={myLoads.filter((l) => l.status !== "delivered").length}
        deliveredCount={deliveredCount}
      />
      <LocationShareCard />

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-heading text-sm font-bold uppercase tracking-wide text-foreground">
            Available near you
          </h2>
          <Link to="/loads" className="text-xs font-semibold text-amber-dim hover:underline">
            See all
          </Link>
        </div>
        <div className="space-y-3">
          {offeredLoads.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
              No new load offers right now.
            </p>
          ) : (
            offeredLoads.slice(0, 2).map((load) => (
              <LoadOfferCard
                key={load.id}
                load={load}
                onAccept={() => void acceptLoad(load.id)}
                onDecline={() => void declineLoad(load.id)}
              />
            ))
          )}
        </div>
      </section>

      <section className="pb-2">
        <h2 className="mb-2 font-heading text-sm font-bold uppercase tracking-wide text-foreground">
          Recent activity
        </h2>
        <div className="space-y-2">
          {activity.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
              Activity from your assigned loads will show up here.
            </p>
          ) : (
            activity.map((item) => (
              <div key={item.id} className="rounded-xl border border-border/70 bg-card p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium text-foreground">{item.title}</div>
                  <div className="shrink-0 font-mono text-[10px] text-muted-foreground">{item.time}</div>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{item.detail}</p>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
