import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n/t";

/** Grid of KPI/stat card placeholders matching the dashboard stat tiles. */
export function StatCardsSkeleton({
  count = 4,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-4 sm:grid-cols-2 lg:grid-cols-4", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i} className="border-border/70 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-2.5">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-7 w-16" />
                <Skeleton className="h-3 w-28" />
              </div>
              <Skeleton className="h-10 w-10 rounded-xl" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/** Placeholder rows for a data table; renders real header cells when `headers` given. */
export function TableSkeleton({
  rows = 6,
  cols = 5,
  headers,
  className,
}: {
  rows?: number;
  cols?: number;
  headers?: string[];
  className?: string;
}) {
  const colCount = headers?.length ?? cols;
  return (
    <div className={cn("overflow-x-auto", className)}>
      <Table>
        <TableHeader>
          <TableRow className="border-border/70">
            {Array.from({ length: colCount }).map((_, j) => (
              <TableHead key={j} className={j === 0 ? "pl-6" : j === colCount - 1 ? "pr-6" : ""}>
                {headers ? headers[j] : <Skeleton className="h-3 w-16" />}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: rows }).map((_, i) => (
            <TableRow key={i} className="border-border/60">
              {Array.from({ length: colCount }).map((__, j) => (
                <TableCell key={j} className={j === 0 ? "pl-6" : j === colCount - 1 ? "pr-6" : ""}>
                  <Skeleton className="h-4 w-full max-w-[140px]" />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Card wrapping a table skeleton, with a title/description placeholder. */
export function TableCardSkeleton({
  rows = 6,
  cols = 5,
  headers,
  className,
}: {
  rows?: number;
  cols?: number;
  headers?: string[];
  className?: string;
}) {
  return (
    <Card className={cn("border-border/70 shadow-sm", className)}>
      <CardHeader className="pb-3">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="mt-1.5 h-3.5 w-56" />
      </CardHeader>
      <CardContent className="px-0 pb-0">
        <TableSkeleton rows={rows} cols={cols} headers={headers} />
      </CardContent>
    </Card>
  );
}

/** Stacked list rows (avatar + two lines), for feeds and side panels. */
export function ListSkeleton({ items = 4, className }: { items?: number; className?: string }) {
  return (
    <div className={cn("space-y-3", className)}>
      {Array.from({ length: items }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-lg border border-border/70 p-3">
          <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Chart-shaped placeholder block. */
export function ChartSkeleton({
  height = 260,
  className,
}: {
  height?: number;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col justify-end gap-2", className)} style={{ height }}>
      <div className="flex h-full items-end gap-3 px-2">
        {[60, 80, 45, 90, 70, 55, 85, 65].map((h, i) => (
          <Skeleton key={i} className="w-full" style={{ height: `${h}%` }} />
        ))}
      </div>
      <Skeleton className="h-3 w-full" />
    </div>
  );
}

/** Label + input pairs, for detail/settings forms. */
export function FormSkeleton({
  fields = 6,
  columns = 2,
  className,
}: {
  fields?: number;
  columns?: 1 | 2 | 3;
  className?: string;
}) {
  const gridCols = { 1: "sm:grid-cols-1", 2: "sm:grid-cols-2", 3: "sm:grid-cols-3" }[columns];
  return (
    <div className={cn("grid gap-4", gridCols, className)}>
      {Array.from({ length: fields }).map((_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-9 w-full" />
        </div>
      ))}
    </div>
  );
}

/** Card wrapping a form skeleton. */
export function FormCardSkeleton({
  fields = 6,
  columns = 2,
  className,
}: {
  fields?: number;
  columns?: 1 | 2 | 3;
  className?: string;
}) {
  return (
    <Card className={cn("border-border/70 shadow-sm", className)}>
      <CardHeader className="pb-3">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="mt-1.5 h-3.5 w-48" />
      </CardHeader>
      <CardContent>
        <FormSkeleton fields={fields} columns={columns} />
      </CardContent>
    </Card>
  );
}

/** Full detail-page placeholder: title block + stat strip + two form cards. */
export function DetailPageSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-6", className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-24" />
        </div>
      </div>
      <StatCardsSkeleton count={4} />
      <div className="grid gap-4 lg:grid-cols-2">
        <FormCardSkeleton fields={6} />
        <FormCardSkeleton fields={6} />
      </div>
    </div>
  );
}

/** Standard list-page placeholder: stat strip + filter bar + table card. */
export function ListPageSkeleton({
  statCards = 4,
  rows = 8,
  cols = 6,
  headers,
  className,
}: {
  statCards?: number;
  rows?: number;
  cols?: number;
  headers?: string[];
  className?: string;
}) {
  return (
    <div className={cn("space-y-6", className)}>
      {statCards > 0 && <StatCardsSkeleton count={statCards} />}
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-9 w-32" />
        <Skeleton className="ml-auto h-9 w-28" />
      </div>
      <TableCardSkeleton rows={rows} cols={cols} headers={headers} />
    </div>
  );
}

/** Page header strip placeholder (matches PageHeader layout). */
export function PageHeaderSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 border-b border-border px-4 py-5 sm:flex-row sm:items-end sm:justify-between sm:px-6 lg:px-8",
        className,
      )}
    >
      <div className="space-y-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-9 w-24" />
        <Skeleton className="h-9 w-24" />
        <Skeleton className="h-9 w-28" />
      </div>
    </div>
  );
}

/** Dashboard-style workspace: KPIs + charts + side lists. */
export function DashboardPageSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-6", className)}>
      <StatCardsSkeleton count={8} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="border-border/70 shadow-sm lg:col-span-2">
          <CardHeader className="pb-3">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="mt-1.5 h-3.5 w-56" />
          </CardHeader>
          <CardContent>
            <ChartSkeleton height={260} />
          </CardContent>
        </Card>
        <Card className="border-border/70 shadow-sm">
          <CardHeader className="pb-3">
            <Skeleton className="h-5 w-32" />
          </CardHeader>
          <CardContent>
            <ListSkeleton items={5} />
          </CardContent>
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-border/70 shadow-sm">
          <CardHeader className="pb-3">
            <Skeleton className="h-5 w-36" />
          </CardHeader>
          <CardContent>
            <ChartSkeleton height={220} />
          </CardContent>
        </Card>
        <Card className="border-border/70 shadow-sm">
          <CardHeader className="pb-3">
            <Skeleton className="h-5 w-28" />
          </CardHeader>
          <CardContent>
            <ListSkeleton items={4} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export type RouteSkeletonVariant = "dashboard" | "list" | "detail" | "form" | "workspace";

/** Infer skeleton layout from the destination pathname. */
export function resolveRouteSkeletonVariant(pathname: string): RouteSkeletonVariant {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/" || path === "/dashboard") return "dashboard";
  if (
    /^\/loads\/[^/]+$/.test(path) ||
    /^\/truckboard\/[^/]+$/.test(path) ||
    /^\/carriers\/[^/]+$/.test(path) ||
    /^\/admin\/users\/[^/]+$/.test(path)
  ) {
    return "detail";
  }
  if (path === "/settings" || path === "/profile" || path === "/login") return "form";
  if (
    path === "/analytics" ||
    path === "/accounting" ||
    path === "/communications" ||
    path === "/landing"
  ) {
    return "workspace";
  }
  return "list";
}

function RouteSkeletonBody({ variant }: { variant: RouteSkeletonVariant }) {
  if (variant === "dashboard") return <DashboardPageSkeleton />;
  if (variant === "detail") return <DetailPageSkeleton />;
  if (variant === "form") {
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        <FormCardSkeleton fields={5} columns={1} />
        <FormCardSkeleton fields={4} columns={1} />
      </div>
    );
  }
  if (variant === "workspace") {
    return (
      <div className="space-y-6">
        <StatCardsSkeleton count={4} />
        <Card className="border-border/70 shadow-sm">
          <CardContent className="flex flex-col items-center gap-3 py-16">
            <Skeleton className="h-12 w-12 rounded-xl" />
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-72 max-w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }
  return <ListPageSkeleton />;
}

/**
 * Full route skeleton for Suspense / pending navigations / page-data gates.
 * Includes header chrome in the authenticated shell so the main pane never jumps blank.
 */
export function RoutePageSkeleton({
  pathname,
  variant,
  bare = false,
  className,
}: {
  pathname?: string;
  variant?: RouteSkeletonVariant;
  /** Public routes (login/landing) — skip app page-header chrome. */
  bare?: boolean;
  className?: string;
}) {
  const resolved =
    variant ??
    resolveRouteSkeletonVariant(
      pathname ?? (typeof window !== "undefined" ? window.location.pathname : "/"),
    );

  return (
    <div
      className={cn("min-w-0", bare && "min-h-[min(560px,100dvh)] bg-background", className)}
      aria-busy="true"
      aria-live="polite"
      role="status"
      aria-label={t("Loading page")}
    >
      {bare ? null : <PageHeaderSkeleton />}
      <div className={cn(bare ? "px-4 py-10 sm:px-6 lg:px-8" : "px-4 py-6 sm:px-6 lg:px-8")}>
        <RouteSkeletonBody variant={resolved} />
      </div>
    </div>
  );
}

/*
 * AuthGateSkeleton lived here. Removed: a login-card skeleton is a guess about
 * what comes next, and it is wrong for every already-authenticated user. See
 * `@/components/auth/RouteLoader`, which renders nothing under 200ms and has a
 * timeout.
 */
