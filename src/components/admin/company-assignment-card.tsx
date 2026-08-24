import * as React from "react";
import { Building2, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { assignUserCompany, listKnownCompanies, type KnownCompany } from "@/lib/admin-users-store";
import { newCompanyId, normalizeCompanyName } from "@/lib/tenant/company-context";
import { isRoleTenantExempt } from "@/lib/tenant/tenant-exemption";
import { strictRole } from "@/lib/tenant/strict-role";
import { t } from "@/lib/i18n/t";

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
  currentEmployerCompanyId,
  currentEmployerCompanyName,
  onAssigned,
}: {
  userId: string;
  /** Drivers are scoped by assignment, not tenancy — see Rule B. */
  role?: string;
  currentCompanyId?: string;
  currentCompanyName?: string;
  /**
   * Employer, for tenant-exempt roles. A Profile field, never a token claim —
   * it decides directory visibility, not data access.
   */
  currentEmployerCompanyId?: string;
  currentEmployerCompanyName?: string;
  onAssigned?: (company: {
    companyId: string | null;
    companyName: string | null;
    scope?: string;
  }) => void;
}) {
  // One input serves both cards; which value seeds it depends on the role.
  const tenantExemptRole = isRoleTenantExempt(strictRole(role));
  const seededName = tenantExemptRole ? currentEmployerCompanyName : currentCompanyName;

  const [companyName, setCompanyName] = React.useState(seededName ?? "");
  const [knownCompanies, setKnownCompanies] = React.useState<KnownCompany[]>([]);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    setCompanyName(seededName ?? "");
  }, [seededName]);

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

      // An employer write touches no token, so none of the sign-in-again copy
      // applies — saying it anyway would send admins chasing a step that does
      // not exist.
      if (result.scope === "employer") {
        toast.success(
          result.companyId ? `Employer set to ${result.companyName}` : "Employer cleared",
          {
            description: result.companyId
              ? "They now appear in that company's directory. Their own access is unchanged."
              : "They no longer appear in any company's directory. Their own access is unchanged.",
          },
        );
      } else if (!result.companyId) {
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
      toast.error(tenantExemptRole ? "Could not set employer" : "Could not assign company", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setSaving(false);
    }
  };

  /**
   * Rule B still holds: a Driver never carries a `companyId` claim, so this card
   * writes their **employer** instead — a Profile field that decides which
   * company's admin sees them in the directory and nothing else.
   *
   * Resolved with `strictRole`, matching the server. `normalizeRole` answers
   * "Operations Manager" for anything it does not recognise, which would quietly
   * show the wrong card for an unexpected role.
   */
  const tenantExempt = isRoleTenantExempt(strictRole(role));

  if (tenantExempt) {
    const employerUnchanged =
      matched?.companyId === currentEmployerCompanyId && Boolean(currentEmployerCompanyId);
    const employerRemoval = !trimmed && Boolean(currentEmployerCompanyId);

    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-4 w-4" /> {t("Employer")}
          </CardTitle>
          <CardDescription>
            {t(
              "Which company this driver works for. This controls who sees them in the user directory\n            and in load-assignment pickers — it grants no access to that company's records.\n            Their own access stays scoped to the loads assigned to them.",
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="space-y-1 block">
            <span className="text-xs font-medium text-muted-foreground">{t("Employer")}</span>
            <Input
              value={companyName}
              onChange={(event) => setCompanyName(event.target.value)}
              list="admin-edit-known-companies"
              placeholder={t("Start typing to pick or create")}
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
            {employerRemoval
              ? "Clearing this hides the driver from every company's directory until an employer is set again."
              : matched
                ? `Existing company · ${matched.userCount} ${matched.userCount === 1 ? "user" : "users"}`
                : trimmed
                  ? "New company."
                  : "No employer set — this driver is not listed in any company's directory."}
          </p>

          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={saving || employerUnchanged || (!trimmed && !currentEmployerCompanyId)}
              onClick={() => void apply(employerRemoval)}
            >
              {saving ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" /> {t("Applying…")}
                </>
              ) : employerRemoval ? (
                "Clear employer"
              ) : (
                "Set employer"
              )}
            </Button>
            {currentEmployerCompanyName && companyName !== currentEmployerCompanyName ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={saving}
                onClick={() => setCompanyName(currentEmployerCompanyName)}
              >
                {t("Cancel")}
              </Button>
            ) : null}
          </div>

          {currentCompanyId ? (
            <div className="space-y-2 rounded-md border border-warning/40 bg-warning/5 p-3">
              <p className="text-xs text-warning">
                {t(
                  "This driver still carries a company claim from before Rule B applied. That claim\n                grants them access to that company's records — remove it.",
                )}
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
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" /> {t("Removing…")}
                  </>
                ) : (
                  "Remove company claim"
                )}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Building2 className="h-4 w-4" /> {t("Company")}
        </CardTitle>
        <CardDescription>
          {t(
            "Determines which records this user can see. Applied immediately — they must sign in again\n          before it takes effect.",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <label className="space-y-1 block">
          <span className="text-xs font-medium text-muted-foreground">{t("Company")}</span>
          <Input
            value={companyName}
            onChange={(event) => setCompanyName(event.target.value)}
            list="admin-edit-known-companies"
            placeholder={t("Start typing to pick or create")}
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
                <Loader2 className="mr-1 h-4 w-4 animate-spin" /> {t("Applying…")}
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
              {t("Cancel")}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
