import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, Package, Truck } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/lib/auth";
import {
  formatNotificationTime,
  pollDriverStatusNotifications,
  type AppNotificationItem,
} from "@/lib/app-notifications-store";
import { cn } from "@/lib/utils";

const POLL_MS = 30_000;
const TOAST_CAP = 2;

function DriverUpdateToast({ item, onOpen }: { item: AppNotificationItem; onOpen: () => void }) {
  const isDelivered = item.title.toLowerCase().includes("delivered");
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "group flex w-[min(100vw-2rem,22rem)] items-stretch gap-3 overflow-hidden rounded-xl border border-border bg-background p-3 text-left shadow-xl",
        "ring-1 ring-black/5 transition hover:border-primary/35 hover:bg-accent/40",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <span
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
          isDelivered
            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            : "bg-sky-500/10 text-sky-600 dark:text-sky-400",
        )}
      >
        {isDelivered ? <Package className="h-4 w-4" /> : <Truck className="h-4 w-4" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Driver update · {formatNotificationTime(item.createdAt)}
        </span>
        <span className="mt-0.5 block truncate text-sm font-semibold text-foreground">
          {item.title}
        </span>
        <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
          {item.description}
        </span>
      </span>
      <span className="flex shrink-0 items-center self-center text-primary opacity-70 transition group-hover:translate-x-0.5 group-hover:opacity-100">
        <ArrowRight className="h-4 w-4" />
      </span>
    </button>
  );
}

/**
 * Polls Loads for driver "Mark as" / document events and surfaces
 * clickable Sonner toasts (inbox is updated via app-notifications-store).
 */
export function DriverStatusNotificationsWatcher() {
  const { user, status } = useAuth();
  const navigate = useNavigate();
  const userId = user?.userId;

  React.useEffect(() => {
    if (status !== "authenticated" || !userId) return;

    let cancelled = false;

    const run = async () => {
      if (document.visibilityState === "hidden") return;
      const fresh = await pollDriverStatusNotifications();
      if (cancelled || fresh.length === 0) return;

      const toToast = fresh.slice(-TOAST_CAP).reverse();
      for (const item of toToast) {
        toast.custom(
          (id) => (
            <DriverUpdateToast
              item={item}
              onOpen={() => {
                toast.dismiss(id);
                if (item.loadId) {
                  void navigate({
                    to: "/tracking",
                    search: { loadId: item.loadId, tab: "messages" },
                  });
                }
              }}
            />
          ),
          {
            id: item.id,
            duration: 9_000,
            position: "top-right",
            className: "!border-0 !bg-transparent !p-0 !shadow-none",
            unstyled: true,
          },
        );
      }

      if (fresh.length > TOAST_CAP) {
        toast.message(
          `${fresh.length - TOAST_CAP} more driver update${fresh.length - TOAST_CAP === 1 ? "" : "s"}`,
          {
            description: "Open Notifications to review everything.",
            duration: 7_000,
          },
        );
      }
    };

    void run();
    const interval = window.setInterval(() => void run(), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void run();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [status, userId, navigate]);

  return null;
}
