import * as React from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { NAV_ITEMS } from "@/lib/nav";
import { SIDEBAR_OPERATIONAL_COUNTS_QUERY_KEY, fetchOperationalCounts } from "@/lib/sidebar-counts";
import {
  getTrackingSessionCountSnapshot,
  subscribeTrackingSessions,
} from "@/lib/tracking-workflow-store";
import { useAuth } from "@/lib/auth";
import { useRbac } from "@/hooks/use-rbac";
import { AppLogoMark } from "@/components/app-logo-mark";

function computeInitials(value: string) {
  const parts = value.split(/[\s@.]+/).filter(Boolean);
  if (parts.length === 0) return "U";
  return (
    parts
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("") || "U"
  );
}

const GROUPS = ["Operations", "Commercial", "Insights", "Workspace"] as const;

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const isActive = (url: string) =>
    url === "/" ? pathname === "/" : pathname === url || pathname.startsWith(url + "/");

  const { user, status } = useAuth();
  const attrs = user?.attributes;
  const { canViewItem, loading: rbacLoading, roleLabel } = useRbac();
  const displayName =
    [attrs?.given_name, attrs?.family_name].filter(Boolean).join(" ").trim() ||
    user?.name ||
    attrs?.nickname ||
    attrs?.preferred_username ||
    user?.email ||
    (status === "loading" ? "Loading…" : "Signed in");

  const role =
    roleLabel ||
    attrs?.["custom:job_title"] ||
    attrs?.["custom:department"] ||
    (status === "loading" || rbacLoading ? "" : "Operations");
  const initials = computeInitials(displayName === "Loading…" ? "U" : displayName);

  const {
    data: operationalCounts,
    isPending: countsPending,
    isError: countsError,
  } = useQuery({
    queryKey: SIDEBAR_OPERATIONAL_COUNTS_QUERY_KEY,
    queryFn: fetchOperationalCounts,
    staleTime: 45_000,
  });
  const trackingSessionCount = React.useSyncExternalStore(
    subscribeTrackingSessions,
    getTrackingSessionCountSnapshot,
    () => 0,
  );

  const sidebarBadge = (item: (typeof NAV_ITEMS)[number]): string | undefined => {
    if (item.liveCount === "loads") {
      if (countsPending) return "…";
      if (countsError || operationalCounts == null) return "—";
      return operationalCounts.loads.toLocaleString();
    }
    if (item.liveCount === "trucks") {
      if (countsPending) return "…";
      if (countsError || operationalCounts == null) return "—";
      return operationalCounts.trucks.toLocaleString();
    }
    if (item.liveCount === "tracking") {
      return trackingSessionCount.toLocaleString();
    }
    if (item.liveCount === "carriers") {
      if (countsPending) return "…";
      if (countsError || operationalCounts == null) return "—";
      return operationalCounts.carriers.toLocaleString();
    }
    return item.badge;
  };

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center gap-2 px-1.5 py-1.5">
          <AppLogoMark className="h-9 w-9 shrink-0 rounded-lg shadow-sm" />
          {!collapsed && (
            <div className="flex min-w-0 flex-col leading-tight">
              <span className="truncate text-sm font-semibold text-sidebar-foreground">
                Logistics Software
              </span>
              <span className="truncate text-[11px] text-sidebar-foreground/60">
                Operations Console
              </span>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        {GROUPS.map((group) => {
          const items = NAV_ITEMS.filter((i) => i.group === group).filter(
            (i) => rbacLoading || canViewItem(i),
          );
          if (items.length === 0) return null;
          return (
            <SidebarGroup key={group}>
              <SidebarGroupLabel className="text-sidebar-foreground/50">{group}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {items.map((item) => {
                    const Icon = item.icon;
                    const active = isActive(item.url);
                    const badge = sidebarBadge(item);
                    return (
                      <SidebarMenuItem key={item.url}>
                        <SidebarMenuButton
                          asChild
                          isActive={active}
                          tooltip={item.title}
                          className="data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground hover:bg-sidebar-accent/60"
                        >
                          <Link to={item.url}>
                            <Icon className="h-4 w-4" />
                            <span>{item.title}</span>
                          </Link>
                        </SidebarMenuButton>
                        {badge != null && !collapsed && (
                          <SidebarMenuBadge className="bg-sidebar-primary/20 text-sidebar-foreground">
                            {badge}
                          </SidebarMenuBadge>
                        )}
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              tooltip={displayName}
              className="h-auto py-1.5 hover:bg-sidebar-accent/60"
            >
              <Link to="/profile">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="bg-sidebar-primary text-sidebar-primary-foreground text-xs font-semibold">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                {!collapsed && (
                  <div className="flex min-w-0 flex-col leading-tight">
                    <span className="truncate text-xs font-medium text-sidebar-foreground">
                      {displayName}
                    </span>
                    {role && (
                      <span className="truncate text-[11px] text-sidebar-foreground/60">
                        {role}
                      </span>
                    )}
                  </div>
                )}
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
