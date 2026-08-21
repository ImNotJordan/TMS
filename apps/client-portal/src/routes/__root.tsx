import { useEffect } from "react";
import { Outlet, createRootRoute, useNavigate, useRouterState } from "@tanstack/react-router";
import { toast } from "sonner";

import { Toaster } from "@/components/ui/sonner";
import { AuthBootSkeleton } from "@/components/page-skeletons";
import { AuthProvider, useAuth } from "@/lib/auth";
import { DISPATCH_APP_URL, DRIVER_APP_URL } from "@/lib/external-links";

export const Route = createRootRoute({
  component: RootComponent,
  notFoundComponent: () => (
    <div className="flex min-h-screen flex-col items-center justify-center gap-2 bg-background px-6 text-center">
      <h1 className="text-lg font-semibold text-foreground">Page not found</h1>
      <p className="text-sm text-muted-foreground">This portal is a single dashboard.</p>
    </div>
  ),
});

function RootComponent() {
  return (
    <AuthProvider>
      <AuthGate />
      <Toaster position="top-center" richColors />
    </AuthProvider>
  );
}

function AuthGate() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const navigate = useNavigate();
  const { status, client, signOut } = useAuth();
  const isLoginRoute = pathname === "/login";

  useEffect(() => {
    if (status === "unauthenticated" && !isLoginRoute) {
      void navigate({ to: "/login", replace: true });
    }
    if (status === "authenticated" && isLoginRoute) {
      void navigate({ to: "/", replace: true });
    }
  }, [status, isLoginRoute, navigate]);

  useEffect(() => {
    if (status !== "authenticated" || !client) return;
    const dest =
      client.audience === "ops"
        ? DISPATCH_APP_URL
        : client.audience === "driver"
          ? DRIVER_APP_URL
          : null;
    if (!dest) return;
    toast.message(
      client.audience === "driver"
        ? "This account belongs on the Driver app"
        : "This account belongs on the Operations Console",
      { description: "Redirecting…" },
    );
    void (async () => {
      await signOut();
      window.location.assign(dest);
    })();
  }, [status, client, signOut]);

  if (isLoginRoute) return <Outlet />;

  if (status !== "authenticated") return <AuthBootSkeleton />;

  if (client?.audience === "ops" || client?.audience === "driver") {
    return <AuthBootSkeleton />;
  }

  return <Outlet />;
}
