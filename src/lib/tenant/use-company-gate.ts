/**
 * Rule A — a user with no company does not get the app.
 *
 * ## Why this is a render gate, not a redirect
 *
 * The obvious implementation is `navigate({ to: "/onboarding" })`. That is a
 * suggestion, not a gate: the user types `/loads` and they are back in the app.
 * Every screen would then need its own check, and the brief is explicit that a
 * solution depending on a developer remembering a check is the wrong solution.
 *
 * So this hook reports a state and `AuthGate` renders *something else* — the
 * routed children never mount. There is no URL that bypasses it, because URLs
 * are not what is being gated.
 *
 * ## What it is not
 *
 * Not a security boundary. It runs in the browser and decides which screen to
 * paint. A user who patches it out sees an empty dashboard, because the server
 * refuses every scoped request with `COMPANY_ASSIGNMENT_REQUIRED` regardless of
 * what the client rendered. This exists so that an unassigned user gets an
 * explanation instead of a wall of failed requests.
 *
 * ## Who is exempt
 *
 * - **Drivers**, per Rule B: they must never hold a `companyId`, so gating them
 *   on having one would lock them out permanently. They are scoped by
 *   assignment instead.
 * - **Platform operators** (a Cognito group, never a stored role): onboarding a
 *   company means acting before any company exists.
 *
 * Both sets come from `tenant-exemption.ts`, the same module the server reads.
 */
import { fetchAuthSession } from "aws-amplify/auth";
import { useCallback, useEffect, useState } from "react";

import { ensureCompanyContext, refreshCompanyContext } from "@/lib/tenant/company-context";
import { strictRole, strictRoleFromGroups } from "@/lib/tenant/strict-role";
import { hasPlatformAdminGroup, isRoleTenantExempt } from "@/lib/tenant/tenant-exemption";

export type CompanyGateState =
  /** Still resolving — show a skeleton, not the app and not the prompt. */
  | "checking"
  /** Assigned, or exempt from needing an assignment. */
  | "ready"
  /** Signed in, not exempt, no company. Show the prompt. */
  | "needs-company";

type GateResult = {
  state: CompanyGateState;
  /** Re-read after an admin has assigned a company. Forces a token refresh. */
  recheck: () => Promise<void>;
  /** True while a recheck is in flight, for button state. */
  rechecking: boolean;
};

/**
 * Is this user exempt from needing a company?
 *
 * Roles are resolved with `strictRole`, never the fuzzy display helper: that one
 * answers `"Operations Manager"` for an unrecognized string, and a resolver that
 * invents roles must not decide exemptions.
 */
export async function isCompanyGateExempt(): Promise<boolean> {
  try {
    const session = await fetchAuthSession();
    const claims = session.tokens?.idToken?.payload as Record<string, unknown> | undefined;
    if (!claims) return false;

    if (hasPlatformAdminGroup(claims)) return true;

    const groups = claims["cognito:groups"];
    const role =
      strictRole(claims["custom:role"]) ??
      (Array.isArray(groups) ? strictRoleFromGroups(groups as string[]) : null);

    return isRoleTenantExempt(role);
  } catch {
    // A token we cannot read is not an exemption. The gate closes, the user sees
    // the prompt, and the server refuses anything they try regardless.
    return false;
  }
}

/**
 * The whole gate decision, with no React in it.
 *
 * Kept separate from the hook deliberately: this is where the tenancy rules
 * live, so this is what the tests drive. The hook below is state plumbing around
 * it, and a test that had to render a component to reach these rules would end
 * up asserting on React instead of on tenancy.
 */
export async function resolveCompanyGateState(options?: {
  forceRefresh?: boolean;
}): Promise<Exclude<CompanyGateState, "checking">> {
  if (await isCompanyGateExempt()) return "ready";
  const context = options?.forceRefresh
    ? await refreshCompanyContext()
    : await ensureCompanyContext();
  return context ? "ready" : "needs-company";
}

/**
 * @param userId The signed-in user, or null/undefined when not authenticated.
 *   Changing it re-runs the check, so a user switch cannot inherit the previous
 *   verdict.
 */
export function useCompanyGate(userId: string | null | undefined): GateResult {
  const [state, setState] = useState<CompanyGateState>("checking");
  const [rechecking, setRechecking] = useState(false);

  const evaluate = useCallback(
    (options?: { forceRefresh?: boolean }) => resolveCompanyGateState(options),
    [],
  );

  useEffect(() => {
    if (!userId) {
      setState("checking");
      return;
    }

    let active = true;
    setState("checking");
    void (async () => {
      const next = await evaluate();
      // Discard a verdict that arrived after the user changed — otherwise a
      // slow check for a previous account decides this one's access.
      if (active) setState(next);
    })();

    return () => {
      active = false;
    };
  }, [userId, evaluate]);

  const recheck = useCallback(async () => {
    setRechecking(true);
    try {
      setState(await evaluate({ forceRefresh: true }));
    } finally {
      setRechecking(false);
    }
  }, [evaluate]);

  return { state, recheck, rechecking };
}
