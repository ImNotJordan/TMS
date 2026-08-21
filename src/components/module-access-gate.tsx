import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Lock, ShieldOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useRbac } from "@/hooks/use-rbac";
import { moduleForPathname } from "@/lib/rbac";
import { t } from "@/lib/i18n/t";

/**
 * Blocks deep-links to modules the user cannot view.
 * AuthGate still handles sign-in; this enforces Profile modulePermissions.
 */
export function ModuleAccessGate({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { loading, canOpenPath, safeHome, permissions } = useRbac();
  const pathname = location.pathname;
  const moduleName = moduleForPathname(pathname);
  const allowed = loading || canOpenPath(pathname);

  useEffect(() => {
    if (loading) return;
    if (allowed) return;
    // Only auto-redirect when hitting a known gated module (not unknown paths).
    if (!moduleName) return;
    if (pathname === safeHome) return;
    void navigate({ to: safeHome, replace: true });
  }, [allowed, loading, moduleName, navigate, pathname, safeHome]);

  if (loading) return children;

  if (!allowed && moduleName) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4 py-16">
        <div className="max-w-md rounded-xl border border-border/70 bg-card/60 p-8 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
            <ShieldOff className="h-6 w-6" />
          </div>
          <h1 className="mt-4 text-lg font-semibold tracking-tight text-foreground">
            {t("Access restricted")}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your role
            {permissions.role ? (
              <>
                {" "}
                (<span className="font-medium text-foreground">{String(permissions.role)}</span>)
              </>
            ) : null}{" "}
            does not include <span className="font-medium text-foreground">{moduleName}</span>. Ask
            an admin to update Role &amp; Access / Module Permissions.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Button asChild size="sm">
              <Link to={safeHome}>{t("Go to available workspace")}</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to="/profile">
                <Lock className="h-3.5 w-3.5" />
                {t("Profile")}
              </Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return children;
}
