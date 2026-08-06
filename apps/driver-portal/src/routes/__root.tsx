import { useEffect } from "react";
import { Outlet, createRootRoute, useNavigate, useRouterState } from "@tanstack/react-router";
import { toast } from "sonner";

import { Toaster } from "@/components/ui/sonner";
import { AuthBootSkeleton } from "@/components/page-skeletons";
import { DriverShell } from "@/components/shell/driver-shell";
import { AuthProvider, useAuth } from "@/lib/auth";
import { LoadsProvider } from "@/lib/loads-store";
import { DriverLocationWatcher } from "@/components/driver-location-watcher";
import { DISPATCH_APP_URL } from "@/lib/external-links";

export const Route = createRootRoute({
  component: RootComponent,
  notFoundComponent: () => (
    <div className="flex min-h-screen flex-col items-center justify-center gap-2 bg-background px-6 text-center">
      <h1 className="text-lg font-semibold text-foreground">Page not found</h1>
      <p className="text-sm text-muted-foreground">That screen doesn't exist in the driver app.</p>
    </div>
  ),
});

function RootComponent() {
  return (
    <AuthProvider>
      <LoadsProvider>
        <DriverLocationWatcher />
        <AuthGate />
        <Toaster position="top-center" richColors />
      </LoadsProvider>
    </AuthProvider>
  );
}

function AuthGate() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const navigate = useNavigate();
  const { status, driver, signOut } = useAuth();
  const isLoginRoute = pathname === "/login";

  useEffect(() => {
    if (status === "unauthenticated" && !isLoginRoute) {
      void navigate({ to: "/login", replace: true });
    }
    if (status === "authenticated" && isLoginRoute) {
      void navigate({ to: "/", replace: true });
    }
  }, [status, isLoginRoute, navigate]);

  // Soft gate: dedicated ops accounts should use the operations console.
  useEffect(() => {
    if (status !== "authenticated" || !driver) return;
    if (driver.audience !== "ops") return;
    toast.message("This account belongs on the Operations Console", {
      description: "Redirecting…",
    });
    void (async () => {
      await signOut();
      window.location.assign(DISPATCH_APP_URL);
    })();
  }, [status, driver, signOut]);

  if (isLoginRoute) {
    return <Outlet />;
  }

  if (status !== "authenticated") {
    return <AuthBootSkeleton />;
  }

  if (driver?.audience === "ops") {
    return <AuthBootSkeleton />;
  }

  return (
    <DriverShell>
      <Outlet />
    </DriverShell>
  );
}
