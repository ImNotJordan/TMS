import { Link, useRouterState } from "@tanstack/react-router";
import { Truck } from "lucide-react";

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
import { useAuth } from "@/lib/auth";
import { useProfileSection } from "@/hooks/use-profile-section";

type PermissionsSnapshot = {
  role?: string;
  permissionGroup?: string;
};

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrator",
  ops: "Operations Manager",
  dispatch: "Dispatcher",
  broker: "Broker",
  driver: "Driver",
};

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
  const permissions = useProfileSection<PermissionsSnapshot>("permissions", {});
  const displayName =
    [attrs?.given_name, attrs?.family_name].filter(Boolean).join(" ").trim() ||
    user?.name ||
    attrs?.nickname ||
    attrs?.preferred_username ||
    user?.email ||
    (status === "loading" ? "Loading…" : "Signed in");

  const dynamoRole = permissions.data.role;
  const role =
    (dynamoRole && (ROLE_LABELS[dynamoRole] ?? dynamoRole)) ||
    attrs?.["custom:job_title"] ||
    attrs?.["custom:department"] ||
    (status === "loading" || permissions.loading ? "" : "Operations");
  const initials = computeInitials(displayName === "Loading…" ? "U" : displayName);

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center gap-2 px-1.5 py-1.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground shadow-sm">
            <Truck className="h-5 w-5" />
          </div>
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
          const items = NAV_ITEMS.filter((i) => i.group === group);
          return (
            <SidebarGroup key={group}>
              <SidebarGroupLabel className="text-sidebar-foreground/50">
                {group}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {items.map((item) => {
                    const Icon = item.icon;
                    const active = isActive(item.url);
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
                        {item.badge && !collapsed && (
                          <SidebarMenuBadge className="bg-sidebar-primary/20 text-sidebar-foreground">
                            {item.badge}
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