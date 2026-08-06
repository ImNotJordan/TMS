import * as React from "react";
import { useRouterState } from "@tanstack/react-router";

import { PageLoadProvider, usePageLoadBusy } from "@/components/page-load-gate";
import { AppScrollRestoration } from "@/components/app-scroll-restoration";
import { RoutePageSkeleton } from "@/components/page-skeleton";
import { cn } from "@/lib/utils";

type PageTransitionProps = {
  children: React.ReactNode;
  /** Public routes (login/landing) — still gate on data; skeleton skips app header chrome. */
  bare?: boolean;
  className?: string;
};

/**
 * Shows a route skeleton while the router is pending or page data is still loading.
 * Content mounts underneath (so fetches can run) and is revealed only when ready.
 */
export function PageTransition({ children, bare = false, className }: PageTransitionProps) {
  return (
    <PageLoadProvider>
      <PageTransitionInner bare={bare} className={className}>
        {children}
      </PageTransitionInner>
    </PageLoadProvider>
  );
}

function PageTransitionInner({
  children,
  bare,
  className,
}: {
  children: React.ReactNode;
  bare: boolean;
  className?: string;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isRouterPending = useRouterState({ select: (s) => s.status === "pending" });
  const dataBusy = usePageLoadBusy();
  const showSkeleton = isRouterPending || dataBusy;

  return (
    <div className={cn("relative min-w-0", className)}>
      <AppScrollRestoration />
      {/* Keep children mounted so page effects/fetches can complete */}
      <div className={showSkeleton ? "hidden" : undefined}>{children}</div>

      {showSkeleton ? (
        <RoutePageSkeleton pathname={pathname} bare={bare} className="relative z-10" />
      ) : null}
    </div>
  );
}
