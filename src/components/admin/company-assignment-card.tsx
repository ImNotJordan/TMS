import * as React from "react";
import { Building2, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { assignUserCompany, listKnownCompanies, type KnownCompany } from "@/lib/admin-users-store";
import { newCompanyId, normalizeCompanyName } from "@/lib/tenant/company-context";
import { TENANT_EXEMPT_ROLES } from "@/lib/tenant/server-tenant-context";
import { normalizeRole } from "@/lib/admin-user-constants";

/**
 * Assign a user to a company.
 *
 * Deliberately separate from the "Save changes" draft flow. Assignment is not a
 * profile edit: it writes `custom:companyId` on the Cognito user through the
 * server, bumps their session epoch, and forces them to sign in again. Bundling
 * that into a form save would make a disruptive, audited action look like
 * editing a job title.
 *
 * The company *name* is a label. The `companyId` is what records are keyed by —
 * matched from an existing company when the name matches one, minted fresh
 * otherwise, never taken as free text.
 */
export function CompanyAssignmentCard({
  userId,
  role,
  currentCompanyId,
  currentCompanyName,
  onAssigned,
}: {
  userId: string;
  /** Drivers are scoped by assignment, not tenancy — see Rule B. */
  role?: string;
  currentCompanyId?: string;
  currentCompanyName?: string;
  onAssigned?: (company: { companyId: string | null; companyName: string | null }) => void;
}) {
  const [companyName, setCompanyName] = React.useState(currentCompanyName ?? "");
  const [knownCompanies, setKnownCompanies] = React.useState<KnownCompany[]>([]);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    setCompanyName(currentCompanyName ?? "");
  }, [currentCompanyName]);

  React.useEffect(() => {
    void listKnownCompanies()
      .then(setKnownCompanies)
      .catch(() => setKnownCompanies([]));
  }, []);

  const matched = React.useMemo(() => {
    const needle = normalizeCompanyName(companyName);
    if (!needle) return null;
    return knownCompanies.find((c) => normalizeCompanyName(c.companyName) === needle) ?? null;
  }, [companyName, knownCompanies]);

  const trimmed = companyName.trim();
  const unchanged = matched?.companyId === currentCompanyId && Boolean(currentCompanyId);
  const isRemoval = !trimmed && Boolean(currentCompanyId);

  const apply = async (removal: boolean) => {
    const company = removal
      ? { companyId: "", companyName: "" }
      : (matched ?? { companyId: newCompanyId(), companyName: trimmed });

    setSaving(true);
    try {
      const result = await assignUserCompany(userId, company);
      onAssigned?.(result);

      if (!result.companyId) {
        toast.success("Removed from company", {
          description: "They will lose access to that company's records when they next sign in.",
        });
      } else {
        toast.success(`Assigned to ${result.companyName}`, {
          description: result.revocationActive
            ? "They must sign in again for the change to take effect."
            : "They must sign in again. Note: custom:sessionEpoch is not configured, so their current session stays valid until it expires.",
        });
      }
    } catch (err) {
      toast.error("Could not assign company", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setSaving(false);
    }
  };

  // Rule B: a Driver never carries a companyId. Offering the field would invite
  // an assignment the server will refuse anyway.
  const tenantExempt = TENANT_EXEMPT_ROLES.has(normalizeRole(role ?? ""));
  if (tenantExempt) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-4 w-4" /> Company
          </CardTitle>
          <CardDescription>
            Drivers are not assigned to a company. Their access is scoped to the loads assigned to
            them, so a company would give them records they should not see.
          </CardDescription>
        </CardHeader>
        {currentCompanyId ? (
          <CardContent className="space-y-3">
            <p className="text-xs text-warning">
              This driver still carries a company from before that rule applied. Remove it.
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={saving}
              onClick={() => void apply(true)}
            >
              {saving ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" /> Removing…
                </>
              ) : (
                "Remove from company"
              )}
            </Button>
          </CardContent>
        ) : null}
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Building2 className="h-4 w-4" /> Company
        </CardTitle>
        <CardDescription>
          Determines which records this user can see. Applied immediately — they must sign in again
          before it takes effect.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <label className="space-y-1 block">
          <span className="text-xs font-medium text-muted-foreground">Company</span>
          <Input
            value={companyName}
            onChange={(event) => setCompanyName(event.target.value)}
            list="admin-edit-known-companies"
            placeholder="Start typing to pick or create"
            autoComplete="off"
            disabled={saving}
          />
          <datalist id="admin-edit-known-companies">
            {knownCompanies.map((company) => (
              <option key={company.companyId} value={company.companyName} />
            ))}
          </datalist>
        </label>

        <p className="text-xs text-muted-foreground">
          {isRemoval
            ? "Clearing this removes them from their company. They will see nothing until reassigned."
            : matched
              ? `Existing company · ${matched.userCount} ${matched.userCount === 1 ? "user" : "users"}`
              : trimmed
                ? "New company — this user will not see any existing records."
                : "Not assigned. This user cannot see or create anything."}
        </p>

        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            disabled={saving || unchanged || (!trimmed && !currentCompanyId)}
            onClick={() => void apply(isRemoval)}
          >
            {saving ? (
              <>
                <Loader2 className="mr-1 h-4 w-4 animate-spin" /> Applying…
              </>
            ) : isRemoval ? (
              "Remove from company"
            ) : (
              "Assign company"
            )}
          </Button>
          {currentCompanyName && companyName !== currentCompanyName ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={saving}
              onClick={() => setCompanyName(currentCompanyName)}
            >
              Cancel
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
