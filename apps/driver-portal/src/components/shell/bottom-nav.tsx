import { Link, useRouterState } from "@tanstack/react-router";
import { Home, MessageSquare, Package, UserCircle2 } from "lucide-react";

import { cn } from "@/lib/utils";

const TABS = [
  { to: "/", label: "Home", icon: Home },
  { to: "/loads", label: "Loads", icon: Package },
  { to: "/chat", label: "Chat", icon: MessageSquare },
  { to: "/profile", label: "Profile", icon: UserCircle2 },
] as const;

export function BottomNav() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });

  return (
    <nav className="sticky bottom-0 z-20 flex shrink-0 items-stretch border-t border-sidebar-border bg-sidebar pb-[env(safe-area-inset-bottom)]">
      {TABS.map((tab) => {
        const active = tab.to === "/" ? pathname === "/" : pathname.startsWith(tab.to);
        const Icon = tab.icon;
        return (
          <Link
            key={tab.to}
            to={tab.to}
            className={cn(
              "flex flex-1 flex-col items-center gap-1 py-2.5 font-heading text-[10px] font-bold uppercase tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar",
              active ? "text-sidebar-primary" : "text-sidebar-foreground/55 hover:text-sidebar-foreground/80",
            )}
          >
            <Icon className="h-5 w-5" />
            {tab.label}
            <span
              className={cn(
                "h-1 w-1 rounded-full transition-all duration-200",
                active ? "scale-100 bg-sidebar-primary opacity-100" : "scale-0 bg-transparent opacity-0",
              )}
            />
          </Link>
        );
      })}
    </nav>
  );
}
