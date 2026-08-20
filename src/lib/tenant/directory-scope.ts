/**
 * Who appears in whose user directory.
 *
 * ## Why a Driver needs a second field
 *
 * Rule B says a Driver never carries `custom:companyId` — see
 * [[tenant-exemption]]. That rule is about the **token claim**, because the
 * claim is what every tenant-scoped query keys on: give a Driver one and the
 * ordinary filter hands them a company's whole dataset.
 *
 * But "which roster does this Driver appear on" is a different question from
 * "whose data may this Driver read", and the old directory filter conflated
 * them. It kept any user *without* a company visible to everyone, so that
 * unassigned users stayed assignable — a carve-out meant for a temporary state.
 * Drivers are in that state permanently by design, so every company's admin saw
 * every driver in the pool.
 *
 * So a Driver's employer is recorded as `employerCompanyId` on their **Profile
 * row only**, never as a claim. Rule B holds exactly as before:
 * `requireCompanyId` still fails closed for a Driver, and their load access is
 * still `assignedDriver = them`.
 *
 * ## Why not reuse `permissions.companyId`
 *
 * That field is the Profile mirror of the token claim, and `company-context.ts`
 * reads it as a legacy fallback when the claim is absent — which is exactly a
 * Driver's situation. Writing a Driver's employer there would make their own
 * client believe it had a company and route them to the wrong screen. The
 * server would still refuse the data, so it is not a leak, but it is a broken
 * app. A distinct field name is load-bearing, not cosmetic.
 */
import { isRoleTenantExempt } from "@/lib/tenant/tenant-exemption";

/** The Profile field naming a Driver's employer. Never a Cognito claim. */
export const EMPLOYER_COMPANY_ID_FIELD = "employerCompanyId";
export const EMPLOYER_COMPANY_NAME_FIELD = "employerCompanyName";

/** The directory fields this predicate reads. */
export type DirectoryScopeSubject = {
  role?: string | null;
  /** Mirror of `custom:companyId`. Absent for Drivers, by Rule B. */
  companyId?: string | null;
  /** Employer, for tenant-exempt roles. Profile-only. */
  employerCompanyId?: string | null;
};

export type DirectoryScopeViewer = {
  companyId?: string | null;
  isPlatformAdmin?: boolean;
};

/**
 * The company a directory row belongs to, whichever field carries it.
 *
 * Returns null for a row with no company at all — a user awaiting assignment,
 * or a Driver whose employer predates this field.
 */
export function directoryCompanyOf(subject: DirectoryScopeSubject): string | null {
  const employer = subject.employerCompanyId?.trim();
  if (isRoleTenantExempt(subject.role ?? undefined)) return employer || null;
  return subject.companyId?.trim() || employer || null;
}

/**
 * May this viewer see this directory row?
 *
 * Three rules, in order:
 *
 * 1. **Platform admins see everyone.** Someone has to be able to reach a Driver
 *    whose employer was never recorded, or they would be unreachable forever —
 *    invisible to every company including the one that needs to fix them. This
 *    is the same escape hatch the assignment endpoint uses, granted by Cognito
 *    group membership rather than a stored role.
 *
 * 2. **A tenant-exempt row is scoped strictly to its employer.** No carve-out:
 *    a Driver with no employer recorded is visible to nobody but a platform
 *    admin. That is the fix — fail closed rather than fall through to "visible
 *    to all", which is what the old filter did.
 *
 * 3. **Everyone else keeps the unassigned carve-out.** A user with no company
 *    yet stays visible so they can be assigned one. The exposure is real but
 *    bounded: it lasts from account creation until assignment, and it is the
 *    only way the assignment screen can show you someone to assign.
 */
export function isVisibleInDirectory(
  subject: DirectoryScopeSubject,
  viewer: DirectoryScopeViewer,
): boolean {
  if (viewer.isPlatformAdmin) return true;

  const viewerCompany = viewer.companyId?.trim();
  if (!viewerCompany) {
    // A viewer with no company of their own has nothing to compare against.
    // Fail closed: an empty directory is recoverable, a full one is a leak.
    return false;
  }

  if (isRoleTenantExempt(subject.role ?? undefined)) {
    return subject.employerCompanyId?.trim() === viewerCompany;
  }

  const company = subject.companyId?.trim();
  if (!company) return true;
  return company === viewerCompany;
}
