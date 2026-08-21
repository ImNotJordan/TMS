/**
 * Tenant gate for Settings credentials.
 *
 * Workspace API keys are per company. Every reader and writer goes through
 * this so a missing company cannot fall through to the legacy shared row.
 */
import { requireCurrentTenantContext } from "@/lib/tenant/request-context";
import {
  requireCompanyId,
  tenantErrorResponse,
} from "@/lib/tenant/server-tenant-context";

export async function requireSettingsCompany(request: Request): Promise<
  { ok: true; companyId: string; userId: string } | { ok: false; response: Response }
> {
  try {
    const ctx = await requireCurrentTenantContext(request);
    return { ok: true, companyId: requireCompanyId(ctx), userId: ctx.userId };
  } catch (err) {
    return {
      ok: false,
      response:
        tenantErrorResponse(err) ??
        Response.json({ error: "Sign in required.", code: "not_authenticated" }, { status: 401 }),
    };
  }
}
