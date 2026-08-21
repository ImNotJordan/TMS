import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  Bell,
  Building2,
  CheckCheck,
  FileSpreadsheet,
  Package,
  Receipt,
  Settings2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  formatNotificationTime,
  getAppNotifications,
  markAllAppNotificationsRead,
  markAppNotificationRead,
  subscribeAppNotifications,
  type AppNotificationItem,
  type AppNotificationType,
} from "@/lib/app-notifications-store";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { t } from "@/lib/i18n/t";

const TYPE_META: Record<
  AppNotificationType,
  { icon: React.ComponentType<{ className?: string }>; tone: string; label: string }
> = {
  load: { icon: Package, tone: "bg-sky-500/10 text-sky-600 dark:text-sky-400", label: "Load" },
  quote: {
    icon: FileSpreadsheet,
    tone: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    label: "Quote",
  },
  carrier: {
    icon: Building2,
    tone: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
    label: "Carrier",
  },
  alert: {
    icon: AlertTriangle,
    tone: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    label: "Alert",
  },
  payment: {
    icon: Receipt,
    tone: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
    label: "Payment",
  },
  system: { icon: Settings2, tone: "bg-muted text-muted-foreground", label: "System" },
};

export function NotificationsPopover() {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<AppNotificationItem[]>(() =>
    getAppNotifications(),
  );
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [open, setOpen] = useState(false);

  useEffect(() => subscribeAppNotifications(() => setNotifications(getAppNotifications())), []);

  const unreadCount = useMemo(() => notifications.filter((n) => !n.read).length, [notifications]);
  const visible = useMemo(
    () => (filter === "unread" ? notifications.filter((n) => !n.read) : notifications),
    [notifications, filter],
  );

  const onItemClick = (item: AppNotificationItem) => {
    markAppNotificationRead(item.id);
    setOpen(false);
    if (item.source === "driver" && item.loadId) {
      void navigate({
        to: "/tracking",
        search: { loadId: item.loadId, tab: "messages" },
      });
      return;
    }
    if (item.loadId) {
      void navigate({ to: "/loads/$loadId", params: { loadId: item.loadId } });
      return;
    }
    if (item.href?.startsWith("/loads/")) {
      const loadId = item.href.replace(/^\/loads\//, "");
      if (loadId) void navigate({ to: "/loads/$loadId", params: { loadId } });
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-9 w-9 rounded-lg"
          aria-label={t("Notifications")}
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 ? (
            <Badge className="absolute -right-0.5 -top-0.5 h-4 min-w-4 justify-center rounded-full bg-destructive px-1 text-[10px] text-destructive-foreground">
              {unreadCount > 9 ? "9+" : unreadCount}
            </Badge>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[380px] max-w-[calc(100vw-1.5rem)] p-0"
      >
        <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-3">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold">{t("Notifications")}</p>
            {unreadCount > 0 ? (
              <Badge variant="secondary" className="h-5 rounded-full px-2 text-[11px]">
                {unreadCount} new
              </Badge>
            ) : null}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
            disabled={unreadCount === 0}
            onClick={() => markAllAppNotificationsRead()}
          >
            <CheckCheck className="h-3.5 w-3.5" />
            {t("Mark all read")}
          </Button>
        </div>

        <div className="px-4 pb-2">
          <Tabs value={filter} onValueChange={(value) => setFilter(value as "all" | "unread")}>
            <TabsList className="h-8 w-full bg-muted/50 p-0.5">
              <TabsTrigger value="all" className="h-7 flex-1 text-xs">
                {t("All")}
              </TabsTrigger>
              <TabsTrigger value="unread" className="h-7 flex-1 text-xs">
                Unread{unreadCount > 0 ? ` (${unreadCount})` : ""}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <Separator />

        <div className="max-h-[24rem] overflow-y-auto">
          {visible.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                <Bell className="h-4 w-4 text-muted-foreground" />
              </span>
              <p className="text-sm font-medium">{t("You're all caught up")}</p>
              <p className="text-xs text-muted-foreground">
                {filter === "unread"
                  ? "No unread notifications."
                  : "Driver status updates will show up here."}
              </p>
            </div>
          ) : (
            <div className="py-1">
              {visible.map((item) => {
                const meta = TYPE_META[item.type];
                const Icon = meta.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={cn(
                      "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-accent",
                      !item.read && "bg-primary/[0.04]",
                    )}
                    onClick={() => onItemClick(item)}
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                        meta.tone,
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span
                          className={cn(
                            "min-w-0 truncate text-sm",
                            item.read ? "text-muted-foreground" : "font-medium",
                          )}
                        >
                          {item.title}
                        </span>
                        {!item.read ? (
                          <span
                            className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                            aria-hidden
                          />
                        ) : null}
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
                        {item.description}
                      </span>
                      <span className="mt-1 block text-[11px] text-muted-foreground/80">
                        {meta.label}
                        {item.source === "driver" ? " · Driver" : ""} ·{" "}
                        {formatNotificationTime(item.createdAt)}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <Separator />

        <div className="p-2">
          <Button
            variant="ghost"
            className="h-8 w-full text-xs text-muted-foreground"
            onClick={() => {
              setOpen(false);
              void navigate({ to: "/loads" });
              toast.message("Opened Loads", {
                description: "Live driver updates also land in this inbox.",
              });
            }}
          >
            {t("View all notifications")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
