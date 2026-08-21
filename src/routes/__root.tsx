import { Suspense, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useLocation,
  useNavigate,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";

import appCss from "../styles.css?url";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Topbar } from "@/components/topbar";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "@/lib/auth";
import { LocaleProvider } from "@/lib/i18n/locale-context";
import { RoutePageSkeleton } from "@/components/page-skeleton";
import { AuthGate as SessionGate } from "@/components/auth/RouteLoader";
import { GlobalScrollbar } from "@/components/global-scrollbar";
import { PageTransition } from "@/components/page-transition";
import { ModuleAccessGate } from "@/components/module-access-gate";
import { CompanyRequired } from "@/components/tenant/company-required";
import { useCompanyGate } from "@/lib/tenant/use-company-gate";
import { DriverStatusNotificationsWatcher } from "@/components/driver-status-notifications-watcher";
import { CLIENT_APP_URL, DRIVER_APP_URL } from "@/lib/external-links";
import { t } from "@/lib/i18n/t";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">{t("Page not found")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("The page you're looking for doesn't exist or has been moved.")}
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t("Go home")}
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {t("This page didn't load")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("Something went wrong on our end. You can try refreshing or head back home.")}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t("Try again")}
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            {t("Go home")}
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Logistics Software — Operations Console" },
      {
        name: "description",
        content:
          "Premium logistics operating system for dispatch, brokerage, tracking, analytics, and accounting.",
      },
      { name: "author", content: "Logistics Software" },
      { property: "og:title", content: "Logistics Software — Operations Console" },
      {
        property: "og:description",
        content:
          "Premium logistics operating system for dispatch, brokerage, tracking, analytics, and accounting.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:site", content: "@Lovable" },
    ],
    links: [
      {
        rel: "icon",
        type: "image/png",
        href: "/logo.png",
      },
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <GlobalScrollbar />
      <AuthProvider>
        {/* Inside AuthProvider: the workspace settings read needs Identity Pool
            credentials, which only exist once a session does. Outside the routed
            children, so one read serves every page. */}
        <LocaleProvider>
          <AuthGate />
        </LocaleProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

function AuthGate() {
  const location = useLocation();
  const navigate = useNavigate();
  const { status, user, signOut, refresh } = useAuth();
  // Rule A. Evaluated here rather than per-route: the routed children below
  // never mount without a company, so there is no URL that bypasses it.
  const companyGate = useCompanyGate(status === "authenticated" ? user?.userId : null);
  const isLoginRoute = location.pathname === "/login";
  const isLandingRoute = location.pathname === "/landing";
  const isPublicRoute = isLoginRoute || isLandingRoute;

  useEffect(() => {
    if (status === "unauthenticated" && !isPublicRoute) {
      void navigate({ to: "/landing", replace: true });
    }
    if (status === "authenticated" && isLoginRoute) {
      void navigate({ to: "/", replace: true });
    }
    if (status === "authenticated" && isLandingRoute) {
      void navigate({ to: "/", replace: true });
    }
  }, [status, isPublicRoute, isLoginRoute, isLandingRoute, navigate]);

  // Soft gate: dedicated driver and client accounts belong on their own apps.
  useEffect(() => {
    if (status !== "authenticated" || !user) return;
    const dest =
      user.audience === "driver"
        ? DRIVER_APP_URL
        : user.audience === "client"
          ? CLIENT_APP_URL
          : null;
    if (!dest) return;
    void (async () => {
      await signOut();
      window.location.assign(dest);
    })();
  }, [status, user, signOut]);

  // The escape hatch on the stalled loader. /login is a public route, so
  // landing there is what clears the resolving state — the branch below returns
  // before any gate runs. No sign-out needed first: `signIn` already calls
  // `safeLocalSignOut` to drop a wedged or half-finished challenge.
  const goToLogin = () => {
    void navigate({ to: "/login", replace: true });
  };

  if (isPublicRoute) {
    return (
      <>
        <Suspense fallback={<RoutePageSkeleton pathname={location.pathname} bare />}>
          <PageTransition bare>
            <Outlet />
          </PageTransition>
        </Suspense>
        <Toaster />
      </>
    );
  }

  if (status !== "authenticated") {
    // `anon` renders nothing: the effect above is already navigating to
    // /landing, and holding a loader over an answered question would strand
    // the app on a screen it has no reason to leave.
    return (
      <SessionGate
        status={status === "loading" ? "resolving" : "anon"}
        onRetry={() => void refresh()}
        onSignIn={goToLogin}
      />
    );
  }

  if (user?.audience === "driver" || user?.audience === "client") {
    return (
      <SessionGate
        status="resolving"
        message={
          user.audience === "client"
            ? "Redirecting to customer portal"
            : "Redirecting to driver app"
        }
        onRetry={() => void refresh()}
        onSignIn={goToLogin}
      />
    );
  }

  // Before the app, not inside it — no sidebar, no topbar, nothing that would
  // fire a scoped request the server is about to refuse anyway.
  if (companyGate.state === "checking") {
    return (
      <SessionGate
        status="resolving"
        message="Checking your workspace"
        onRetry={() => void companyGate.recheck()}
        onSignIn={goToLogin}
      />
    );
  }

  if (companyGate.state === "needs-company") {
    return (
      <>
        <CompanyRequired onRecheck={companyGate.recheck} rechecking={companyGate.rechecking} />
        <Toaster />
      </>
    );
  }

  return (
    <SidebarProvider>
      <DriverStatusNotificationsWatcher />
      <AppSidebar />
      <SidebarInset className="min-w-0 overflow-x-hidden bg-background">
        <Topbar />
        <main className="min-w-0 flex-1 overflow-x-hidden">
          <Suspense fallback={<RoutePageSkeleton pathname={location.pathname} />}>
            <PageTransition>
              <ModuleAccessGate>
                <Outlet />
              </ModuleAccessGate>
            </PageTransition>
          </Suspense>
        </main>
      </SidebarInset>
      <Toaster />
    </SidebarProvider>
  );
}
