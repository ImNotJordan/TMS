import { Building2, LogOut, RefreshCw } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { t } from "@/lib/i18n/t";

/**
 * Shown to a signed-in user whose account carries no company.
 *
 * ## Why there is no "enter your company name" field
 *
 * Because tenancy would then be self-assigned. A user who types a company name
 * chooses which tenant they join, and on a second account typing the same name
 * joins the first user's data. `custom:companyId` is deliberately not writable by
 * the app client for exactly this reason — offering the field here would route
 * around that with extra steps.
 *
 * Assignment happens through the admin endpoint, under the server principal,
 * by somebody who already belongs to the company. So this screen's only job is
 * to explain the wait and let the user re-check once it is done.
 *
 * The identifiers shown are the user's own — their email and their own sub —
 * which they can already read from their token. Nothing about any company is
 * displayed, because a user with no tenant has no business learning which
 * tenants exist.
 */
export function CompanyRequired({
  onRecheck,
  rechecking,
}: {
  onRecheck: () => Promise<void>;
  rechecking: boolean;
}) {
  const { user, signOut } = useAuth();
  const [checkedOnce, setCheckedOnce] = useState(false);

  async function handleRecheck() {
    await onRecheck();
    // If the gate had opened, this component would already be unmounted — so
    // reaching this line means the assignment still is not there.
    setCheckedOnce(true);
  }

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-xl border border-border/70 bg-card/60 p-8 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Building2 className="h-6 w-6" />
        </div>

        <h1 className="mt-4 text-lg font-semibold tracking-tight text-foreground">
          {t("Waiting for company access")}
        </h1>

        <p className="mt-2 text-sm text-muted-foreground">
          {t(
            "Your account is not assigned to a company yet. An administrator at your company needs to\n          assign it before you can see any data.",
          )}
        </p>

        {user?.email ? (
          <p className="mt-4 text-xs text-muted-foreground">
            Signed in as <span className="font-medium text-foreground">{user.email}</span>
          </p>
        ) : null}

        {checkedOnce ? (
          <p
            className="mt-4 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            {t(
              "Still not assigned. If an administrator has just done it, they may need to confirm it\n            saved — the change reaches you on your next token refresh.",
            )}
          </p>
        ) : null}

        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button size="sm" onClick={() => void handleRecheck()} disabled={rechecking}>
            <RefreshCw className={rechecking ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
            {rechecking ? "Checking…" : "Check again"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => void signOut()}>
            <LogOut className="h-3.5 w-3.5" />
            {t("Sign out")}
          </Button>
        </div>

        {user?.userId ? (
          <p className="mt-6 border-t border-border/60 pt-4 text-[11px] leading-relaxed text-muted-foreground">
            If you need to contact support, your account id is{" "}
            <code className="font-mono text-foreground">{user.userId}</code>
          </p>
        ) : null}
      </div>
    </div>
  );
}
