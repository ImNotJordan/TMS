import { useNavigate } from "@tanstack/react-router";
import { MessageSquare, Package, Truck } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  useNotifications,
  type AppNotification,
  type NotificationType,
} from "@/lib/notifications-store";
import { cn } from "@/lib/utils";

const TYPE_ICON: Record<NotificationType, LucideIcon> = {
  "load-offer": Package,
  "status-change": Truck,
  message: MessageSquare,
};

function formatRelativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function NotificationPanel({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const { notifications, markRead } = useNotifications();

  const openNotification = (n: AppNotification) => {
    markRead(n.id);
    onOpenChange(false);
    if (n.type === "load-offer" && n.loadId) {
      void navigate({ to: "/loads", search: { tab: "available", highlight: n.loadId } });
    } else if (n.type === "status-change" && n.loadId) {
      void navigate({ to: "/loads/$loadId", params: { loadId: n.loadId } });
    } else if (n.type === "message") {
      // No per-thread routing yet — one active chat thread per driver.
      void navigate({ to: "/chat" });
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="top" className="rounded-b-3xl pt-[max(1.5rem,env(safe-area-inset-top))]">
        <SheetHeader>
          <SheetTitle className="font-heading text-xl font-bold">Notifications</SheetTitle>
        </SheetHeader>

        <div className="mt-4 max-h-[60vh] space-y-2 overflow-y-auto">
          {notifications.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
              Nothing here yet.
            </p>
          ) : (
            notifications.map((n) => {
              const Icon = TYPE_ICON[n.type];
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => openNotification(n)}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    n.read ? "border-border/70 bg-card" : "border-amber/30 bg-amber/5",
                  )}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-foreground">{n.text}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {formatRelativeTime(n.createdAt)}
                    </span>
                  </span>
                  {!n.read ? (
                    <span
                      aria-hidden
                      className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-amber"
                    />
                  ) : null}
                </button>
              );
            })
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
