import * as React from "react";
import { useRouterState } from "@tanstack/react-router";

import { PhoneFrame } from "./phone-frame";
import { TopBar } from "./top-bar";
import { BottomNav } from "./bottom-nav";
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

  return (
    <PhoneFrame>
      <LoadAssignmentWatcher />
      <InstallAppBanner />
      <TopBar />
      <main
        className={cn(
          "relative min-h-0 flex-1",
          isChat ? "flex flex-col overflow-hidden" : "overflow-y-auto",
        )}
      >
        <div
          className={cn(
            showSkeleton && "hidden",
            isChat ? "flex min-h-0 flex-1 flex-col" : "min-h-full",
          )}
        >
          {children}
        </div>
        {showSkeleton ? (
          <div className={cn(isChat && "flex min-h-0 flex-1 flex-col")}>
            <RouteSkeleton pathname={pathname} />
          </div>
        ) : null}
      </main>
      <BottomNav />
    </PhoneFrame>
  );
}
