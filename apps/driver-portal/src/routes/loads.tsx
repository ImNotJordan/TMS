import { useEffect, useRef, useState } from "react";
import { Outlet, createFileRoute, Link, useRouterState, useSearch } from "@tanstack/react-router";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LoadOfferCard } from "@/components/loads/load-offer-card";
import { useLoads } from "@/lib/loads-store";
import { STATUS_LABELS, type Load } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

type LoadsTab = "available" | "mine" | "recent";

type LoadsSearch = {
  tab?: LoadsTab;
  highlight?: string;
};

export const Route = createFileRoute("/loads")({
  component: LoadsPage,
  validateSearch: (search: Record<string, unknown>): LoadsSearch => ({
    tab:
      search.tab === "available" || search.tab === "mine" || search.tab === "recent"
        ? search.tab
        : undefined,
    highlight: typeof search.highlight === "string" ? search.highlight : undefined,
  }),
});

/** Any status where the truck is actively moving reads as "live" — amber, same
 *  signal as the Home hero. Not-yet-moving and finished states stay quiet. */
const STATUS_TONE: Record<string, string> = {
  delivered: "bg-success/15 text-success",
  "en-route-delivery": "bg-amber/15 text-amber-dim",
  "en-route-pickup": "bg-amber/15 text-amber-dim",
  "at-pickup": "bg-amber/15 text-amber-dim",
  loaded: "bg-amber/15 text-amber-dim",
  "at-delivery": "bg-amber/15 text-amber-dim",
  assigned: "bg-secondary text-secondary-foreground",
};

function LoadsPage() {
  useEffect(() => {
    document.title = "Loads — Titan Freight Driver";
  }, []);

  const search = useSearch({ from: "/loads" });
  const [tab, setTab] = useState<LoadsTab>(search.tab ?? "available");
  const [declineTarget, setDeclineTarget] = useState<Load | null>(null);
  const { offeredLoads, myLoads, recordsById, acceptLoad, declineLoad } = useLoads();
  const highlightId = search.highlight;
  const highlightRef = useRef<HTMLDivElement | null>(null);

  // A deep link (e.g. from a notification) can arrive while this route is
  // already mounted — sync the tab/scroll instead of only reading it once.
  useEffect(() => {
    if (search.tab) setTab(search.tab);
  }, [search.tab]);

  useEffect(() => {
    if (!highlightId) return;
    highlightRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightId, offeredLoads]);

  // Dispatch-assigned loads live in "Available" until accepted — badge the tab so the
  // driver doesn't go looking for them under "My loads".
  const pendingAssignments = offeredLoads.filter((l) => l.assignedByDispatch).length;
  const activeMyLoads = myLoads.filter((l) => l.status !== "delivered");
  const completedLoads = myLoads
    .filter((l) => l.status === "delivered")
    .sort((a, b) => {
      const bAt = recordsById[b.id]?.updatedAt ?? "";
      const aAt = recordsById[a.id]?.updatedAt ?? "";
      return bAt.localeCompare(aAt);
    });

  // /loads/$loadId is nested under this route (file-based routing) but is its
  // own full-screen view on mobile, not a persistent list+detail layout — so
  // hand off to the child route entirely instead of rendering both at once.
  const isDetailRoute = useRouterState({
    select: (r) => r.location.pathname.startsWith("/loads/"),
  });
  if (isDetailRoute) {
    return <Outlet />;
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-500 space-y-4 px-4 py-5">
      <div className="flex w-full rounded-full border border-border bg-muted/50 p-1">
        <button
          type="button"
          onClick={() => setTab("available")}
          className={cn(
            "flex-1 rounded-full py-1.5 font-heading text-xs font-bold uppercase tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            tab === "available" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
          )}
        >
          Available <span className="font-mono normal-case tracking-normal">({offeredLoads.length})</span>
          {pendingAssignments > 0 ? (
            <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-mono text-[9px] font-bold normal-case tracking-normal text-primary-foreground">
              {pendingAssignments}
            </span>
          ) : null}
        </button>
        <button
          type="button"
          onClick={() => setTab("mine")}
          className={cn(
            "flex-1 rounded-full py-1.5 font-heading text-xs font-bold uppercase tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            tab === "mine" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
          )}
        >
          My loads <span className="font-mono normal-case tracking-normal">({activeMyLoads.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setTab("recent")}
          className={cn(
            "flex-1 rounded-full py-1.5 font-heading text-xs font-bold uppercase tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            tab === "recent" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
          )}
        >
          Recent load <span className="font-mono normal-case tracking-normal">({completedLoads.length})</span>
        </button>
      </div>

      {tab === "available" ? (
        <div className="space-y-3">
          {offeredLoads.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
              No new load offers right now. Check back soon.
            </p>
          ) : (
            offeredLoads.map((load) => (
              <div
                key={load.id}
                ref={load.id === highlightId ? highlightRef : undefined}
                className={cn(
                  "rounded-2xl transition-shadow",
                  load.id === highlightId && "ring-2 ring-amber ring-offset-2 ring-offset-background",
                )}
              >
                <LoadOfferCard
                  load={load}
                  onAccept={() => void acceptLoad(load.id)}
                  onDecline={() => setDeclineTarget(load)}
                />
              </div>
            ))
          )}
        </div>
      ) : tab === "mine" ? (
        <div className="space-y-2.5">
          {activeMyLoads.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
              No active loads right now.
            </p>
          ) : (
            activeMyLoads.map((load) => (
              <Link
                key={load.id}
                to="/loads/$loadId"
                params={{ loadId: load.id }}
                className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-card p-3.5 transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <div className="min-w-0">
                  <div className="font-heading text-sm font-bold text-foreground">
                    {load.pickup.city} → {load.delivery.city}
                  </div>
                  <div className="mt-0.5 font-mono text-xs text-muted-foreground">
                    {load.id} · {load.distanceMiles} mi
                  </div>
                </div>
                <Badge variant="outline" className={cn("shrink-0 border-transparent", STATUS_TONE[load.status])}>
                  {STATUS_LABELS[load.status]}
                </Badge>
              </Link>
            ))
          )}
        </div>
      ) : (
        <div className="space-y-2.5">
          {completedLoads.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
              No completed loads yet.
            </p>
          ) : (
            completedLoads.map((load) => (
              <Link
                key={load.id}
                to="/loads/$loadId"
                params={{ loadId: load.id }}
                className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-card p-3.5 transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <div className="min-w-0">
                  <div className="font-heading text-sm font-bold text-foreground">
                    {load.pickup.city} → {load.delivery.city}
                  </div>
                  <div className="mt-0.5 font-mono text-xs text-muted-foreground">
                    {load.id} · {load.distanceMiles} mi
                  </div>
                </div>
                <Badge variant="outline" className={cn("shrink-0 border-transparent", STATUS_TONE[load.status])}>
                  {STATUS_LABELS[load.status]}
                </Badge>
              </Link>
            ))
          )}
        </div>
      )}

      <Dialog open={!!declineTarget} onOpenChange={(open) => !open && setDeclineTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Decline {declineTarget?.id}?</DialogTitle>
            <DialogDescription>
              This load will be released back to dispatch for reassignment.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeclineTarget(null)}>
              Keep offer
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (declineTarget) void declineLoad(declineTarget.id);
                setDeclineTarget(null);
              }}
            >
              Decline load
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
