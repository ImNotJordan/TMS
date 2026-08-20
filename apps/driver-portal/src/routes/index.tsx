import { useEffect } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ActiveLoadCard } from "@/components/home/active-load-card";
import { NoActiveLoadCard } from "@/components/home/no-active-load-card";
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
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-500 space-y-5 px-4 py-5">
      {error ? (
        <div className="flex items-center gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 p-3.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-destructive/15 text-destructive">
            <AlertTriangle className="h-4 w-4" />
          </span>
          <p className="min-w-0 flex-1 truncate text-xs font-medium text-destructive">
            Couldn't sync with AWS — {error}
          </p>
          <Button
            size="sm"
            variant="outline"
            className="h-8 shrink-0 gap-1.5"
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
        <NoActiveLoadCard
          offeredLoads={offeredLoads}
          onAccept={(id) => void acceptLoad(id)}
          onDecline={(id) => void declineLoad(id)}
        />
      )}

      <QuickStats
        milesToday={milesProxy}
        activeCount={myLoads.filter((l) => l.status !== "delivered").length}
        deliveredCount={deliveredCount}
      />
      <LocationShareCard />

      {activeLoad ? (
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-heading text-sm font-bold text-foreground">Available near you</h2>
            <Link to="/loads" className="text-xs font-semibold text-amber-dim hover:underline">
              See all
            </Link>
          </div>
          <div className="space-y-3">
            {offeredLoads.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                No new load offers right now
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
      ) : null}

      <section className="pb-2">
        <h2 className="mb-2 font-heading text-sm font-bold text-foreground">Recent activity</h2>
        <div className="space-y-2">
          {activity.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
              Activity from your assigned loads will show up here
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
