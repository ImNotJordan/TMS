import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
import {
  ExternalLink,
  Loader2,
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
import { useQueryClient } from "@tanstack/react-query";

import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/lib/auth";
import { useProfileSection } from "@/hooks/use-profile-section";
import { toast } from "sonner";
import { NotificationsPopover } from "@/components/notifications-popover";
import { AiHeaderButton } from "@/components/logistics-ai/ai-header-button";
import { invalidateOperationalCounts } from "@/lib/sidebar-counts";
import { DRIVER_APP_URL } from "@/lib/external-links";
import { listAllLoadsCached } from "@/lib/loads-store";
import { getTrackingSessionsSnapshot } from "@/lib/tracking-workflow-store";
import { listAllTrucksCached } from "@/lib/trucks-store";
import {
  buildGlobalSearchIndex,
  searchGlobalIndex,
  type GlobalSearchResult,
  type GlobalSearchResultType,
} from "@/lib/global-search";

const CreateLoadDialog = lazy(() =>
  import("@/components/loads/create-load-dialog").then((m) => ({
    default: m.CreateLoadDialog,
  })),
);

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
  const [createLoadOpen, setCreateLoadOpen] = useState(false);
  const [signOutDialogOpen, setSignOutDialogOpen] = useState(false);
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [globalSearchQuery, setGlobalSearchQuery] = useState("");
  const [globalSearchLoading, setGlobalSearchLoading] = useState(false);
  const [globalSearchError, setGlobalSearchError] = useState<string | null>(null);
  const [globalSearchIndex, setGlobalSearchIndex] = useState<GlobalSearchResult[]>([]);
  const searchWrapRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const { user, status, signOut } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
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

  const performSignOut = async () => {
    setSignOutBusy(true);
    try {
      await signOut();
      toast.success("Signed out");
      setSignOutDialogOpen(false);
      navigate({ to: "/login", replace: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sign out failed";
      toast.error(message);
    } finally {
      setSignOutBusy(false);
    }
  };

  const ensureGlobalSearchIndex = useCallback(
    async (force = false) => {
      if (!force && globalSearchIndex.length > 0) return;
      setGlobalSearchLoading(true);
      setGlobalSearchError(null);
      try {
        const [loads, trucks] = await Promise.all([listAllLoadsCached(), listAllTrucksCached()]);
        const sessions = getTrackingSessionsSnapshot();
        setGlobalSearchIndex(buildGlobalSearchIndex({ loads, trucks, sessions }));
      } catch (err) {
        const message = err instanceof Error ? err.message : "Could not load search index";
        setGlobalSearchError(message);
      } finally {
        setGlobalSearchLoading(false);
      }
    },
    [globalSearchIndex.length],
  );

  useEffect(() => {
    if (!globalSearchOpen) return;
    void ensureGlobalSearchIndex();
  }, [globalSearchOpen, ensureGlobalSearchIndex]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === "k") {
        event.preventDefault();
        setGlobalSearchOpen(false);
        searchInputRef.current?.focus();
        void ensureGlobalSearchIndex();
        return;
      }
      if (key === "escape") {
        setGlobalSearchOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [ensureGlobalSearchIndex]);

  useEffect(() => {
    if (!globalSearchOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!searchWrapRef.current?.contains(target)) {
        setGlobalSearchOpen(false);
      }
    };
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [globalSearchOpen]);

  const visibleSearchResults = useMemo(
    () => searchGlobalIndex(globalSearchIndex, globalSearchQuery, 48),
    [globalSearchIndex, globalSearchQuery],
  );

  const groupedSearchResults = useMemo(() => {
    const byType: Record<GlobalSearchResultType, GlobalSearchResult[]> = {
      load: [],
      carrier: [],
      lane: [],
      contact: [],
      document: [],
    };
    for (const row of visibleSearchResults) {
      byType[row.type].push(row);
    }
    return byType;
  }, [visibleSearchResults]);

  const openSearch = useCallback(() => {
    void ensureGlobalSearchIndex();
  }, [ensureGlobalSearchIndex]);

  const selectSearchResult = useCallback(
    (result: GlobalSearchResult) => {
      setGlobalSearchOpen(false);
      setGlobalSearchQuery("");

      if (result.loadId) {
        void navigate({ to: "/loads/$loadId", params: { loadId: result.loadId } });
        return;
      }
      if (result.truckBoardId) {
        void navigate({
          to: "/truckboard/$truckBoardId",
          params: { truckBoardId: result.truckBoardId },
        });
        return;
      }
      if (result.type === "carrier" || result.type === "contact") {
        void navigate({ to: "/carriers" });
        return;
      }
      if (result.type === "document") {
        void navigate({ to: "/tracking" });
        return;
      }
      void navigate({ to: "/loads" });
    },
    [navigate],
  );

  const typeLabels: Record<GlobalSearchResultType, string> = {
    load: "Load",
    carrier: "Carrier",
    lane: "Lane",
    contact: "Contact",
    document: "Document/OCR",
  };
  const orderedTypes: GlobalSearchResultType[] = ["load", "carrier", "lane", "contact", "document"];

  return (
    <>
      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/80 px-3 backdrop-blur-md sm:px-4">
      <SidebarTrigger />
      <Separator orientation="vertical" className="h-6" />

      <div ref={searchWrapRef} className="relative ml-1 hidden max-w-md flex-1 md:block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={searchInputRef}
          aria-label="Global search"
          placeholder="Search loads, carriers, lanes, contacts, documents..."
          className="h-9 rounded-lg border-border bg-muted/40 pl-9 pr-16 text-sm focus-visible:ring-1"
          value={globalSearchQuery}
          onChange={(event) => {
            const nextQuery = event.target.value;
            setGlobalSearchQuery(nextQuery);
            const show = nextQuery.trim().length > 0;
            setGlobalSearchOpen(show);
            if (show) void ensureGlobalSearchIndex();
          }}
          onFocus={openSearch}
        />
        <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 select-none rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline-block">
          Ctrl/Cmd+K
        </kbd>
        {globalSearchOpen && globalSearchQuery.trim().length > 0 ? (
          <div className="absolute left-0 right-0 top-[calc(100%+0.45rem)] z-50 overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
            {globalSearchLoading ? (
              <div className="px-3 py-3 text-sm text-muted-foreground">Building global search index...</div>
            ) : null}
            {globalSearchError ? (
              <div className="px-3 py-3 text-sm text-destructive">
                {globalSearchError}{" "}
                <button
                  type="button"
                  className="font-medium underline underline-offset-2"
                  onClick={() => void ensureGlobalSearchIndex(true)}
                >
                  Retry
                </button>
              </div>
            ) : null}
            {!globalSearchLoading && !globalSearchError ? (
              <div className="max-h-[22rem] overflow-y-auto py-1">
                {visibleSearchResults.length === 0 ? (
                  <div className="px-3 py-3 text-sm text-muted-foreground">No matches found.</div>
                ) : (
                  orderedTypes.map((type) => {
                    const rows = groupedSearchResults[type];
                    if (rows.length === 0) return null;
                    return (
                      <div key={type}>
                        <div className="px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                          {typeLabels[type]}
                        </div>
                        {rows.map((row) => (
                          <button
                            key={row.id}
                            type="button"
                            className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => selectSearchResult(row)}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm">{row.title}</div>
                              <div className="truncate text-xs text-muted-foreground">{row.subtitle}</div>
                            </div>
                            <span className="shrink-0 text-[10px] text-muted-foreground">{typeLabels[row.type]}</span>
                          </button>
                        ))}
                      </div>
                    );
                  })
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="ml-auto flex items-center gap-1">
        <AiHeaderButton />
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
                <DropdownMenuItem
                  key={q.label}
                  className="gap-2"
                  onSelect={() => {
                    if (q.label === "New Load") {
                      setCreateLoadOpen(true);
                      return;
                    }
                    toast.info("Coming soon", { description: `${q.label} isn't available yet.` });
                  }}
                >
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

        <NotificationsPopover />

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
            <DropdownMenuItem onSelect={() => navigate({ to: "/profile" })}>
              Profile
            </DropdownMenuItem>
            <DropdownMenuItem>Preferences</DropdownMenuItem>
            <DropdownMenuItem>Switch organization</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="gap-2"
              onSelect={() => window.open(DRIVER_APP_URL, "_blank", "noopener,noreferrer")}
            >
              <ExternalLink className="h-4 w-4 text-muted-foreground" />
              Driver app
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive"
              onSelect={() => setSignOutDialogOpen(true)}
            >
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      </header>

      {createLoadOpen ? (
        <Suspense fallback={null}>
          <CreateLoadDialog
            open={createLoadOpen}
            onOpenChange={setCreateLoadOpen}
            onCreated={(id) => {
              invalidateOperationalCounts(queryClient);
              toast.success("Load created", { description: id });
              void navigate({ to: "/loads/$loadId", params: { loadId: id } });
            }}
          />
        </Suspense>
      ) : null}

      <AlertDialog
        open={signOutDialogOpen}
        onOpenChange={(open) => {
          setSignOutDialogOpen(open);
          if (!open) setSignOutBusy(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out?</AlertDialogTitle>
            <AlertDialogDescription>
              You will need to sign in again to use Titan Freight.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={signOutBusy}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={signOutBusy}
              onClick={() => void performSignOut()}
              className="gap-2"
            >
              {signOutBusy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Signing out...
                </>
              ) : (
                "Sign out"
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}




