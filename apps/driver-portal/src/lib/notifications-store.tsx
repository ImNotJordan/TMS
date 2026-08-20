import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

import { useLoads } from "./loads-store";
import { STATUS_LABELS } from "./mock-data";

export type NotificationType = "load-offer" | "status-change" | "message";

export type AppNotification = {
  id: string;
  type: NotificationType;
  text: string;
  /** ISO timestamp. */
  createdAt: string;
  read: boolean;
  /** Present for load-offer and status-change; absent for message (no per-thread routing yet). */
  loadId?: string;
};

type NotificationsContextValue = {
  notifications: AppNotification[];
  unreadCount: number;
  markAllRead: () => void;
  markRead: (id: string) => void;
};

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

/**
 * No notifications backend exists yet. This seeds a few illustrative rows from
 * whatever real loads are already loaded (so deep links go somewhere real),
 * once, the first time both an offer and an active/delivered load are available.
 *
 * Replace this effect with a real feed (push events, polling, whatever lands)
 * without touching the context shape below it.
 */
export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { ready, offeredLoads, myLoads } = useLoads();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const seeded = useRef(false);

  useEffect(() => {
    if (seeded.current || !ready) return;
    const offer = offeredLoads[0];
    const changed = myLoads.find((l) => l.status === "delivered") ?? myLoads[0];
    if (!offer && !changed) return;
    seeded.current = true;

    const now = Date.now();
    const seedList: AppNotification[] = [];

    if (offer) {
      seedList.push({
        id: `seed-offer-${offer.id}`,
        type: "load-offer",
        text: "New load offer available near you",
        createdAt: new Date(now - 2 * 60_000).toISOString(),
        read: false,
        loadId: offer.id,
      });
    }
    if (changed) {
      seedList.push({
        id: `seed-status-${changed.id}`,
        type: "status-change",
        text: `Load ${changed.id} status changed to ${STATUS_LABELS[changed.status] ?? changed.status}`,
        createdAt: new Date(now - 20 * 60_000).toISOString(),
        read: false,
        loadId: changed.id,
      });
    }
    seedList.push({
      id: "seed-message-dispatch",
      type: "message",
      text: "New message from dispatch",
      createdAt: new Date(now - 62 * 60_000).toISOString(),
      read: true,
    });

    setNotifications(seedList);
  }, [ready, offeredLoads, myLoads]);

  const unreadCount = useMemo(() => notifications.filter((n) => !n.read).length, [notifications]);

  const markAllRead = () => {
    setNotifications((prev) =>
      prev.every((n) => n.read) ? prev : prev.map((n) => ({ ...n, read: true })),
    );
  };

  const markRead = (id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
  };

  const value = useMemo<NotificationsContextValue>(
    () => ({ notifications, unreadCount, markAllRead, markRead }),
    [notifications, unreadCount],
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error("useNotifications must be used inside <NotificationsProvider>");
  return ctx;
}
