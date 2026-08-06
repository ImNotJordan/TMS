import { QueryClient } from "@tanstack/react-query";
import { createRouter, useRouterState } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { RoutePageSkeleton } from "@/components/page-skeleton";

function DefaultPendingSkeleton() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return <RoutePageSkeleton pathname={pathname} />;
}

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Pathname (not history entry) so sidebar revisits restore the last offset.
    getScrollRestorationKey: (location) => location.pathname,
    scrollRestorationBehavior: "instant",
    defaultPreloadStaleTime: 0,
    defaultPendingMs: 0,
    defaultPendingMinMs: 0,
    defaultPendingComponent: DefaultPendingSkeleton,
  });

  return router;
};
