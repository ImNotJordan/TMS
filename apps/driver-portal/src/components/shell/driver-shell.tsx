import * as React from "react";
import { useRouterState } from "@tanstack/react-router";

import { PhoneFrame } from "./phone-frame";
import { TopBar } from "./top-bar";
import { FloatingBottomNav } from "./floating-bottom-nav";
import {
  ChatPageSkeleton,
  HomePageSkeleton,
  LoadDetailSkeleton,
  LoadsPageSkeleton,
  ProfilePageSkeleton,
} from "@/components/page-skeletons";
import { LoadAssignmentWatcher } from "@/components/load-assignment-watcher";
import { InstallAppBanner } from "@/components/shell/install-app-banner";
import { useDriverDataBusy } from "@/lib/loads-store";
import { cn } from "@/lib/utils";

function RouteSkeleton({ pathname }: { pathname: string }) {
  if (pathname.startsWith("/loads/") && pathname !== "/loads") return <LoadDetailSkeleton />;
  if (pathname.startsWith("/loads")) return <LoadsPageSkeleton />;
  if (pathname.startsWith("/chat")) return <ChatPageSkeleton />;
  if (pathname.startsWith("/profile")) return <ProfilePageSkeleton />;
  return <HomePageSkeleton />;
}

export function DriverShell({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isRouterPending = useRouterState({ select: (s) => s.status === "pending" });
  const dataBusy = useDriverDataBusy();
  const showSkeleton = isRouterPending || dataBusy;
  // Chat owns its own scroll + docked composer; don't nest another scrollport.
  const isChat = pathname.startsWith("/chat");
  // Profile is a fixed, single-screen layout by design — it fits within the
  // available space rather than scrolling behind (or past) the floating nav.
  const isProfile = pathname.startsWith("/profile");
  const noScroll = isChat || isProfile;

  return (
    <PhoneFrame>
      <LoadAssignmentWatcher />
      <InstallAppBanner />
      <TopBar />
      <main
        className={cn(
          "relative min-h-0 flex-1",
          noScroll
            ? "flex flex-col overflow-hidden"
            : "overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        )}
      >
        <div
          className={cn(
            showSkeleton && "hidden",
            // Chat manages its own internal flex layout (docked composer) —
            // no centering, no clearance, it's already nav-safe by construction.
            // Profile is non-scrolling but still benefits from safe-centering:
            // short content centers in the available space; if it's ever too
            // tall, "safe" clips only the bottom rather than the top.
            // Everything else scrolls normally, with shared bottom clearance
            // so nothing can render behind the floating nav.
            isChat
              ? "flex min-h-0 flex-1 flex-col"
              : isProfile
                ? "flex min-h-0 flex-1 flex-col justify-[safe_center]"
                : "flex min-h-full flex-col justify-[safe_center] pb-[var(--nav-clearance)]",
          )}
        >
          {children}
        </div>
        {showSkeleton ? (
          <div className={cn(noScroll && "flex min-h-0 flex-1 flex-col")}>
            <RouteSkeleton pathname={pathname} />
          </div>
        ) : null}
      </main>
      <FloatingBottomNav />
    </PhoneFrame>
  );
}
