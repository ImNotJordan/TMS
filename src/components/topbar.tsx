import { useState, useEffect } from "react";
import {
  Bell,
  MessageSquare,
  Plus,
  Search,
  Moon,
  Sun,
  Package,
  FileSpreadsheet,
  FileText,
  Building2,
  UserPlus,
  Receipt,
} from "lucide-react";

import { useNavigate } from "@tanstack/react-router";

import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";
import { useProfileSection } from "@/hooks/use-profile-section";
import { toast } from "sonner";

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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const QUICK_CREATE = [
  { label: "New Load", icon: Package },
  { label: "New Quote", icon: FileSpreadsheet },
  { label: "New RFP", icon: FileText },
  { label: "Add Carrier", icon: Building2 },
  { label: "Add Broker", icon: UserPlus },
  { label: "New Invoice", icon: Receipt },
];

export function Topbar() {
  const [dark, setDark] = useState(false);
  const { user, status, signOut } = useAuth();
  const navigate = useNavigate();
  const permissions = useProfileSection<PermissionsSnapshot>("permissions", {});
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  const attrs = user?.attributes;
  const displayName =
    [attrs?.given_name, attrs?.family_name].filter(Boolean).join(" ").trim() ||
    user?.name ||
    attrs?.nickname ||
    attrs?.preferred_username ||
    user?.email ||
    "Account";
  const dynamoRole = permissions.data.role;
  const roleLine =
    (dynamoRole && (ROLE_LABELS[dynamoRole] ?? dynamoRole)) ||
    attrs?.["custom:job_title"] ||
    attrs?.["custom:department"] ||
    (status === "loading" || permissions.loading ? "" : "Signed in");
  const initials = (displayName === "Account" ? "U" : displayName)
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("") || "U";

  const handleSignOut = async () => {
    try {
      await signOut();
      toast.success("Signed out");
      navigate({ to: "/login", replace: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sign out failed";
      toast.error(message);
    }
  };

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/80 px-3 backdrop-blur-md sm:px-4">
      <SidebarTrigger />
      <Separator orientation="vertical" className="h-6" />

      <div className="relative ml-1 hidden max-w-md flex-1 md:block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search loads, carriers, quotes, invoices…"
          className="h-9 rounded-lg border-border bg-muted/40 pl-9 pr-16 text-sm focus-visible:ring-1"
        />
        <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 select-none rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline-block">
          ⌘K
        </kbd>
      </div>

      <div className="ml-auto flex items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" className="h-9 gap-1.5 rounded-lg shadow-sm">
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Create</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel>Quick create</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {QUICK_CREATE.map((q) => {
              const Icon = q.icon;
              return (
                <DropdownMenuItem key={q.label} className="gap-2">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  {q.label}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-lg"
          onClick={() => setDark((d) => !d)}
          aria-label="Toggle theme"
        >
          {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>

        <Button variant="ghost" size="icon" className="relative h-9 w-9 rounded-lg" aria-label="Messages">
          <MessageSquare className="h-4 w-4" />
          <Badge className="absolute -right-0.5 -top-0.5 h-4 min-w-4 justify-center rounded-full bg-info px-1 text-[10px] text-info-foreground">
            4
          </Badge>
        </Button>

        <Button variant="ghost" size="icon" className="relative h-9 w-9 rounded-lg" aria-label="Notifications">
          <Bell className="h-4 w-4" />
          <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-destructive" />
        </Button>

        <Separator orientation="vertical" className="mx-1 h-6" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-9 gap-2 rounded-lg pl-1 pr-2">
              <Avatar className="h-7 w-7">
                <AvatarFallback className="bg-primary text-primary-foreground text-xs font-semibold">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="hidden flex-col items-start leading-tight md:flex">
                <span className="text-xs font-medium">{displayName}</span>
                {roleLine && (
                  <span className="text-[10px] text-muted-foreground">{roleLine}</span>
                )}
              </div>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel>My account</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Profile</DropdownMenuItem>
            <DropdownMenuItem>Preferences</DropdownMenuItem>
            <DropdownMenuItem>Switch organization</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onSelect={handleSignOut}>
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}