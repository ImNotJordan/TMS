import * as React from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Loader2, Save, UserCircle2, X } from "lucide-react";
import { toast } from "sonner";

import { EditUserForm } from "@/components/admin/edit-user-form";
import { CompanyAssignmentCard } from "@/components/admin/company-assignment-card";
import { getAdminDirectoryUserById } from "@/lib/admin-users-store";
import { Button } from "@/components/ui/button";
import { usePageReady } from "@/components/page-load-gate";
import {
  auditActorFromAuth,
  recordAdminAuditLog,
  summarizeUserEditDiff,
} from "@/lib/admin-audit-store";
import { cacheAdminDirectoryUser } from "@/lib/admin-users-store";
import {
  loadAdminUserEditDraft,
  saveAdminUserEditDraft,
  type AdminUserEditDraft,
} from "@/lib/admin-user-edit";
import { clearProfileSectionCache } from "@/hooks/use-profile-section";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/users/$userId")({
  head: ({ params }) => ({
    meta: [
      { title: `Edit user — ${params.userId}` },
      { name: "description", content: "Edit user profile, role, and permissions." },
    ],
  }),
  component: AdminEditUserPage,
});

function AdminEditUserPage() {
  const { userId } = Route.useParams();
  const navigate = useNavigate();
  const { user: authUser } = useAuth();

  const [baseline, setBaseline] = React.useState<AdminUserEditDraft | null>(null);
  const [draft, setDraft] = React.useState<AdminUserEditDraft | null>(null);
  const [fetchState, setFetchState] = React.useState<"loading" | "error" | "ready" | "missing">(
    "loading",
  );
  const [fetchError, setFetchError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  // Company assignment is not part of the editable draft — it is applied
  // immediately through its own endpoint, so it is tracked separately.
  const [company, setCompany] = React.useState<{
    companyId?: string;
    companyName?: string;
  }>({});

  usePageReady(fetchState === "loading");

  const dirty = React.useMemo(() => {
    if (!baseline || !draft) return false;
    return JSON.stringify(baseline) !== JSON.stringify(draft);
  }, [baseline, draft]);

  React.useEffect(() => {
    let cancelled = false;
    setFetchState("loading");
    setFetchError(null);

    void (async () => {
      try {
        const loaded = await loadAdminUserEditDraft(userId);
        if (cancelled) return;
        if (!loaded) {
          setFetchState("missing");
          return;
        }
        setBaseline(loaded);
        setDraft(loaded);
        setFetchState("ready");

        // Non-blocking: the form is usable even if the company lookup fails.
        void getAdminDirectoryUserById(userId)
          .then((entry) => {
            if (cancelled || !entry) return;
            setCompany({ companyId: entry.companyId, companyName: entry.companyName });
          })
          .catch(() => {
            /* leave unassigned — the card shows "Not assigned" */
          });
      } catch (err) {
        if (cancelled) return;
        setFetchError(err instanceof Error ? err.message : "Could not load user");
        setFetchState("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  const handleDiscard = () => {
    if (baseline) setDraft(baseline);
  };

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const saved = await saveAdminUserEditDraft(draft);
      if (authUser?.userId) cacheAdminDirectoryUser(authUser.userId, saved);
      // If an admin edits their own permissions, drop the cached RBAC snapshot so the shell reloads it.
      if (authUser?.userId && authUser.userId === userId) {
        clearProfileSectionCache(userId);
      }
      if (baseline) {
        await recordAdminAuditLog({
          actor: auditActorFromAuth(authUser),
          action: "User Updated",
          record: draft.email || userId,
          details: summarizeUserEditDiff(baseline, draft),
        });
      }
      setBaseline(draft);
      toast.success("User saved to UsersTable.");
      void navigate({ to: "/admin" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not save user";
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const displayName =
    draft && (draft.firstName || draft.lastName)
      ? `${draft.firstName} ${draft.lastName}`.trim()
      : draft?.email || userId;

  if (fetchState === "loading") {
    return null;
  }

  if (fetchState === "error") {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <div className="rounded-xl border border-destructive/30 bg-destructive/8 p-6 text-sm text-destructive">
          <div className="font-semibold">Could not load this user</div>
          <p className="mt-2 text-xs opacity-90">{fetchError}</p>
          <Button className="mt-4" variant="outline" asChild>
            <Link to="/admin">Back to admin</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (fetchState === "missing" || !draft) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-20 text-center">
        <UserCircle2 className="h-12 w-12 text-muted-foreground" />
        <div>
          <h1 className="text-lg font-semibold text-foreground">User not found</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            No profile in UsersTable for <span className="font-mono">{userId}</span>.
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link to="/admin">Back to admin</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100dvh-4rem)] pb-10 pt-4">
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
        <div className="sticky top-0 z-20 -mx-px mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-border/70 bg-background/95 px-1 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="flex min-w-0 items-center gap-3">
            <Button variant="ghost" size="icon" className="shrink-0" asChild>
              <Link to="/admin" aria-label="Back to admin">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <UserCircle2 className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-lg font-semibold tracking-tight text-foreground">
                  Edit user
                </h1>
                <p className="truncate text-xs text-muted-foreground">
                  {displayName}
                  {dirty ? " · Unsaved changes" : " · Saved"}
                </p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {dirty && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleDiscard}
                className="text-muted-foreground"
              >
                <X className="mr-1 h-4 w-4" /> Discard
              </Button>
            )}
            <Button type="button" variant="outline" size="sm" asChild>
              <Link to="/admin">Close</Link>
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!dirty || saving}
              onClick={() => void handleSave()}
              className={cn(
                "bg-gradient-to-r from-success to-primary text-primary-foreground shadow-sm shadow-success/25 hover:opacity-95 disabled:opacity-40",
              )}
            >
              {saving ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" /> Saving…
                </>
              ) : (
                <>
                  <Save className="mr-1 h-4 w-4" /> Save changes
                </>
              )}
            </Button>
          </div>
        </div>

        <CompanyAssignmentCard
          userId={userId}
          role={draft.role}
          currentCompanyId={company.companyId}
          currentCompanyName={company.companyName}
          onAssigned={(assigned) =>
            setCompany({
              companyId: assigned.companyId ?? undefined,
              companyName: assigned.companyName ?? undefined,
            })
          }
        />

        <EditUserForm draft={draft} onChange={setDraft} />
      </div>
    </div>
  );
}
