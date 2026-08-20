import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function HomePageSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("space-y-5 px-4 py-5", className)}
      role="status"
      aria-busy="true"
      aria-label="Loading home"
    >
      <div className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-2.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-3.5 w-1/2" />
          </div>
          <Skeleton className="h-10 w-10 rounded-xl" />
        </div>
        <div className="mt-4 space-y-2">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
          <Skeleton className="h-9 w-full rounded-lg" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2.5">
        <Skeleton className="h-16 rounded-xl" />
        <Skeleton className="h-16 rounded-xl" />
        <Skeleton className="h-16 rounded-xl" />
      </div>
      <Skeleton className="h-20 rounded-2xl" />
      <div className="space-y-3">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
      </div>
    </div>
  );
}

export function LoadsPageSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("space-y-4 px-4 py-5", className)}
      role="status"
      aria-busy="true"
      aria-label="Loading loads"
    >
      <Skeleton className="h-10 w-full rounded-full" />
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-28 w-full rounded-xl" />
      ))}
    </div>
  );
}

export function LoadDetailSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("space-y-4 px-4 py-5", className)}
      role="status"
      aria-busy="true"
      aria-label="Loading load details"
    >
      <Skeleton className="h-44 w-full rounded-xl" />
      <Skeleton className="h-36 w-full rounded-xl" />
      <Skeleton className="h-24 w-full rounded-xl" />
      <div className="flex gap-3">
        <Skeleton className="h-11 flex-1 rounded-lg" />
        <Skeleton className="h-11 flex-1 rounded-lg" />
      </div>
    </div>
  );
}

export function ChatPageSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("flex min-h-0 flex-1 flex-col", className)}
      role="status"
      aria-busy="true"
      aria-label="Loading chat"
    >
      <div className="shrink-0 border-b border-border/70 px-4 py-2.5">
        <Skeleton className="h-3 w-36" />
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-hidden px-4 py-4">
        <Skeleton className="h-16 w-3/4 rounded-2xl" />
        <Skeleton className="ml-auto h-14 w-2/3 rounded-2xl" />
        <Skeleton className="h-20 w-4/5 rounded-2xl" />
        <Skeleton className="ml-auto h-12 w-1/2 rounded-2xl" />
      </div>
      <div className="shrink-0 space-y-2 border-t border-border/80 px-3 py-3">
        <div className="flex gap-2">
          <Skeleton className="h-8 w-28 rounded-full" />
          <Skeleton className="h-8 w-32 rounded-full" />
          <Skeleton className="h-8 w-24 rounded-full" />
        </div>
        <Skeleton className="h-11 w-full rounded-full" />
      </div>
    </div>
  );
}

export function ProfilePageSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("space-y-5 px-4 py-5", className)}
      role="status"
      aria-busy="true"
      aria-label="Loading profile"
    >
      <div className="flex items-center gap-3">
        <Skeleton className="h-14 w-14 rounded-full" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-48" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2.5">
        <Skeleton className="h-14 rounded-xl" />
        <Skeleton className="h-14 rounded-xl" />
        <Skeleton className="h-14 rounded-xl" />
      </div>
      <Skeleton className="h-44 w-full rounded-xl" />
      <Skeleton className="h-28 w-full rounded-xl" />
    </div>
  );
}

export function AuthBootSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex min-h-screen items-center justify-center bg-muted/30 px-6",
        className,
      )}
      role="status"
      aria-busy="true"
      aria-label="Signing you in"
    >
      <div className="w-full max-w-xs space-y-4">
        <Skeleton className="mx-auto h-12 w-12 rounded-xl" />
        <Skeleton className="mx-auto h-4 w-40" />
        <Skeleton className="h-24 w-full rounded-2xl" />
      </div>
    </div>
  );
}
