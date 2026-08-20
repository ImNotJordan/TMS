import { Link, useRouterState } from "@tanstack/react-router";
import { Home, MessageSquare, Package, ScanLine, UserCircle2 } from "lucide-react";

import { cn } from "@/lib/utils";

const TABS = [
  { to: "/", label: "Home", icon: Home },
  { to: "/loads", label: "Loads", icon: Package },
  { to: "/chat", label: "Chat", icon: MessageSquare },
  { to: "/profile", label: "Profile", icon: UserCircle2 },
] as const;

export function FloatingBottomNav() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const [homeTab, loadsTab, chatTab, profileTab] = TABS;

  const renderTab = (tab: (typeof TABS)[number]) => {
    const active = tab.to === "/" ? pathname === "/" : pathname.startsWith(tab.to);
    const Icon = tab.icon;
    return (
      <Link
        key={tab.to}
        to={tab.to}
        className="flex flex-1 flex-col items-center gap-1 py-1 focus-visible:outline-none"
      >
        <span
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-full transition-colors",
            active && "bg-amber/15",
          )}
        >
          <Icon className={cn("h-5 w-5", active ? "text-amber" : "text-sidebar-foreground/55")} />
        </span>
        <span
          className={cn(
            "text-[10px] font-medium",
            active ? "text-amber" : "text-sidebar-foreground/55",
          )}
        >
          {tab.label}
        </span>
        <span
          className={cn(
            "h-1 w-1 rounded-full transition-all duration-200",
            active ? "scale-100 bg-amber opacity-100" : "scale-0 bg-transparent opacity-0",
          )}
        />
      </Link>
    );
  };

  return (
    <div className="relative px-4 pb-[var(--safe-bottom)]">
      <nav className="flex items-center justify-between rounded-full bg-ink px-2 py-2">
        {renderTab(homeTab)}
        {renderTab(loadsTab)}
        <div className="w-14 shrink-0" aria-hidden />
        {renderTab(chatTab)}
        {renderTab(profileTab)}
      </nav>

      {/* Placeholder for a future scanner feature — intentionally has no handler yet. */}
      <button
        type="button"
        aria-label="Scan"
        className="absolute left-1/2 top-2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/3 items-center justify-center rounded-full bg-amber ring-[5px] ring-background focus-visible:outline-none"
      >
        <ScanLine className="h-6 w-6 text-ink" />
      </button>
    </div>
  );
}
