import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function AuthBootSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("flex min-h-screen items-center justify-center bg-background px-6", className)}
      role="status"
      aria-busy="true"
      aria-label="Signing you in"
    >
      <div className="w-full max-w-sm space-y-4">
        <Skeleton className="mx-auto h-12 w-12 rounded-xl" />
        <Skeleton className="mx-auto h-4 w-48" />
        <Skeleton className="h-40 w-full rounded-2xl" />
      </div>
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row" role="status" aria-busy="true">
      <Skeleton className="min-h-[280px] flex-1 rounded-none" />
      <div className="w-full space-y-3 border-l border-border bg-background p-4 lg:w-[400px]">
        <div className="grid grid-cols-3 gap-2">
          <Skeleton className="h-16 rounded-lg" />
          <Skeleton className="h-16 rounded-lg" />
          <Skeleton className="h-16 rounded-lg" />
        </div>
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
      </div>
    </div>
  );
}
