import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, MapPin, Package } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/lib/auth";
import { useLoads } from "@/lib/loads-store";
import {
  addUnreadAssignmentIds,
  formatLoadRate,
  formatLoadRoute,
  markAssignmentsSeen,
  notifiableLoads,
  readPushPreference,
  readSeenAssignmentIds,
  showBrowserLoadNotification,
  writeSeenAssignmentIds,
} from "@/lib/load-notifications";
import type { Load } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

const POLL_MS = 45_000;
const TOAST_CAP = 2;

function AssignmentToastCard({
  load,
  kind,
  onOpen,
}: {
  load: Load;
  kind: "offer" | "assigned";
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "group flex w-[min(100vw-2rem,22rem)] items-stretch gap-3 overflow-hidden rounded-2xl border border-border/80 bg-background p-3 text-left shadow-xl",
        "ring-1 ring-black/5 transition hover:border-primary/40 hover:bg-accent/40",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <span
        className={cn(
          "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
          kind === "offer" ? "bg-amber/15 text-amber" : "bg-primary/12 text-primary",
        )}
      >
        {kind === "offer" ? <Package className="h-5 w-5" /> : <MapPin className="h-5 w-5" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            {kind === "offer" ? "New offer" : "Assigned to you"}
          </span>
          <span className="font-mono text-[10px] text-muted-foreground">{load.id}</span>
        </span>
        <span className="mt-0.5 block truncate text-sm font-semibold text-foreground">
          {formatLoadRoute(load)}
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {formatLoadRate(load)} · {load.distanceMiles.toLocaleString()} mi · {load.equipment}
        </span>
      </span>
      <span className="flex shrink-0 items-center self-center text-primary opacity-70 transition group-hover:translate-x-0.5 group-hover:opacity-100">
        <ArrowRight className="h-4 w-4" />
      </span>
    </button>
  );
}

/**
 * Polls for newly offered/assigned loads, then fires clickable toasts + optional browser notifications.
 */
export function LoadAssignmentWatcher() {
  const { driver } = useAuth();
  const { ready, offeredLoads, myLoads, refresh, refreshing } = useLoads();
  const navigate = useNavigate();
  const seededRef = React.useRef(false);
  const userId = driver?.userId;

  // Reset seed when driver changes
  React.useEffect(() => {
    seededRef.current = false;
  }, [userId]);

  // Poll + refresh when tab becomes visible
  React.useEffect(() => {
    if (!userId || !ready) return;

    const tick = () => {
      if (document.visibilityState === "hidden") return;
      void refresh();
    };

    const interval = window.setInterval(tick, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [userId, ready, refresh]);

  // Open load from OS notification click
  React.useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ loadId?: string }>).detail;
      const loadId = detail?.loadId;
      if (!loadId || !userId) return;
      markAssignmentsSeen(userId, [loadId]);
      void navigate({ to: "/loads/$loadId", params: { loadId } });
    };
    window.addEventListener("driver-portal:open-load", onOpen);
    return () => window.removeEventListener("driver-portal:open-load", onOpen);
  }, [navigate, userId]);

  // Diff notifiable loads against last-seen set
  React.useEffect(() => {
    if (!userId || !ready || refreshing) return;

    const candidates = notifiableLoads([...offeredLoads, ...myLoads]);
    const currentIds = candidates.map((l) => l.id);
    const seen = readSeenAssignmentIds(userId);

    if (!seededRef.current) {
      writeSeenAssignmentIds(userId, new Set([...seen, ...currentIds]));
      seededRef.current = true;
      return;
    }

    const fresh = candidates.filter((l) => !seen.has(l.id));
    if (fresh.length === 0) return;

    const nextSeen = new Set(seen);
    for (const load of fresh) nextSeen.add(load.id);
    writeSeenAssignmentIds(userId, nextSeen);
    addUnreadAssignmentIds(
      userId,
      fresh.map((l) => l.id),
    );

    const pushOn = readPushPreference(userId);
    const toToast = fresh.slice(0, TOAST_CAP);

    for (const load of toToast) {
      const kind: "offer" | "assigned" = load.status === "offered" ? "offer" : "assigned";
      const open = () => {
        markAssignmentsSeen(userId, [load.id]);
        toast.dismiss(`assign-${load.id}`);
        void navigate({ to: "/loads/$loadId", params: { loadId: load.id } });
      };

      toast.custom(
        (id) => (
          <AssignmentToastCard
            load={load}
            kind={kind}
            onOpen={() => {
              toast.dismiss(id);
              open();
            }}
          />
        ),
        {
          id: `assign-${load.id}`,
          duration: 10_000,
          position: "top-center",
          className: "!border-0 !bg-transparent !p-0 !shadow-none",
          unstyled: true,
        },
      );

      if (pushOn) {
        showBrowserLoadNotification(load, kind);
      }
    }

    try {
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        navigator.vibrate?.(40);
      }
    } catch {
      /* ignore */
    }

    if (fresh.length > TOAST_CAP) {
      toast.message(`${fresh.length - TOAST_CAP} more new load${fresh.length - TOAST_CAP === 1 ? "" : "s"}`, {
        description: "Open Loads to review everything.",
        action: {
          label: "Loads",
          onClick: () => void navigate({ to: "/loads" }),
        },
        duration: 8_000,
      });
    }
  }, [userId, ready, refreshing, offeredLoads, myLoads, navigate]);

  return null;
}
