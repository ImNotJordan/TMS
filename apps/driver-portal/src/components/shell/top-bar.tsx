import * as React from "react";
import { Bell, ChevronLeft } from "lucide-react";
import { Link, useNavigate, useParams, useRouterState } from "@tanstack/react-router";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { NotificationPanel } from "@/components/shell/notification-panel";
import { useAuth } from "@/lib/auth";
import { markAssignmentsSeen } from "@/lib/load-notifications";
import { useNotifications } from "@/lib/notifications-store";
import { cn } from "@/lib/utils";

export function TopBar() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const navigate = useNavigate();
  const { driver } = useAuth();
  const params = useParams({ strict: false }) as { loadId?: string };
  const userId = driver?.userId;

  const { unreadCount, markAllRead } = useNotifications();
  const [notificationsOpen, setNotificationsOpen] = React.useState(false);

  // Mark assignment seen when opening a load detail
  React.useEffect(() => {
    if (!userId || !params.loadId) return;
    if (!pathname.startsWith("/loads/")) return;
    markAssignmentsSeen(userId, [params.loadId]);
  }, [userId, params.loadId, pathname]);

  const isLoadDetail = pathname.startsWith("/loads/") && !!params.loadId;

  let title = "Titan Freight";
  let subtitle: string | undefined = driver ? `Hi, ${driver.name.split(" ")[0]}` : undefined;
  if (pathname === "/loads") {
    title = "Loads";
    subtitle = undefined;
  }
  if (isLoadDetail) {
    title = params.loadId as string;
    subtitle = "Load details";
  }
  if (pathname === "/chat") {
    title = "Dispatch chat";
    subtitle = "Live";
  }
  if (pathname === "/profile") {
    title = "Profile";
    subtitle = undefined;
  }

  const openNotifications = () => {
    setNotificationsOpen(true);
    markAllRead();
  };

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur-md">
      {isLoadDetail ? (
        <Button
          variant="ghost"
          size="icon"
          className="-ml-2 h-9 w-9 shrink-0 rounded-full"
          onClick={() => navigate({ to: "/loads" })}
          aria-label="Back to loads"
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>
      ) : null}

      <div className="min-w-0 flex-1 leading-tight">
        <div
          className={cn(
            "truncate text-sm font-bold",
            isLoadDetail ? "font-mono" : "font-heading uppercase tracking-wide",
            "text-foreground",
          )}
        >
          {title}
        </div>
        {subtitle ? (
          <div
            className={cn(
              "truncate text-[11px]",
              pathname === "/chat" ? "flex items-center gap-1 text-success" : "text-muted-foreground",
            )}
          >
            {pathname === "/chat" ? <span className="h-1.5 w-1.5 rounded-full bg-success" /> : null}
            {subtitle}
          </div>
        ) : null}
      </div>

      {pathname === "/" || pathname === "/loads" ? (
        <>
          <Button
            variant="ghost"
            size="icon"
            className="relative h-9 w-9 rounded-full"
            aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} new` : "Notifications"}
            onClick={openNotifications}
          >
            <Bell className="h-4 w-4" />
            {unreadCount > 0 ? (
              <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber px-1 text-[9px] font-bold text-ink shadow-sm">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            ) : null}
          </Button>
          <NotificationPanel open={notificationsOpen} onOpenChange={setNotificationsOpen} />
        </>
      ) : null}

      {pathname === "/" ? (
        <Link
          to="/profile"
          className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Avatar className="h-8 w-8">
            <AvatarFallback className="bg-gradient-to-br from-ink-elevated to-ink font-heading text-xs font-bold text-amber">
              {driver?.initials ?? "U"}
            </AvatarFallback>
          </Avatar>
        </Link>
      ) : null}
    </header>
  );
}
