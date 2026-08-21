/**
 * Which loads a Client portal user may see.
 *
 * ## Why this is not "the company's board, filtered in the browser"
 *
 * A Client account is a company user — they carry a `companyId`, unlike a
 * Driver — so the ordinary tenant filter would hand them every load that
 * company has booked. That is every other shipper's freight, rates included.
 * The Client role exists specifically so a customer can watch *their* moves,
 * and nothing else.
 *
 * Assigned customer names are stored on the profile (`permissions.assignedCustomers`)
 * by an admin of the same company. They are compared to `LoadRecord.customer`.
 * Empty assignment is an empty dashboard, not "all loads": failing open here
 * would make a half-finished invite the most privileged account in the tenant.
 *
 * Matching is exact and case-insensitive. Substring matching would let
 * "Acme" also pull "Acme West" and "Not Acme". The admin types the name as it
 * appears on the load.
 */
import { isLoadDelivered, normalizeLoadStatus } from "@/lib/load-status";
import { logTenantDenial, type TenantContext } from "@/lib/tenant/server-tenant-context";

/** Split a stored assignment string into comparable customer names. */
export function parseAssignedCustomers(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return uniqueNames(raw.filter((value): value is string => typeof value === "string"));
  }
  if (typeof raw !== "string") return [];
  return uniqueNames(raw.split(/[,;\n]+/));
}

function uniqueNames(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const name = value.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** Does this load's customer field match one of the assigned names? */
export function loadBelongsToAssignedCustomers(
  customer: string | undefined | null,
  assigned: readonly string[],
): boolean {
  if (assigned.length === 0) return false;
  const name = customer?.trim().toLowerCase();
  if (!name) return false;
  return assigned.some((entry) => entry.trim().toLowerCase() === name);
}

/**
 * In-flight freight a client should see on the live board.
 *
 * Drafts are ops paperwork. Cancelled and completed are closed. Delivered
 * (by either record of it — see `isLoadDelivered`) has left the truck.
 * Everything between booked and at-delivery stays.
 */
export function isClientActiveLoad(load: {
  loadStatus?: string | null;
  driverWorkflowStatus?: string | null;
}): boolean {
  const status = normalizeLoadStatus(load.loadStatus);
  if (!status) return false;
  if (status === "draft" || status === "cancelled" || status === "completed") return false;
  if (isLoadDelivered(load)) return false;
  return true;
}

/**
 * Clients have a company, so the ordinary tenant filter would hand them the
 * whole board. Their only API is `/api/client/dashboard`. Anywhere else is a
 * routing bug, and it must not be a working one.
 */
export function refuseClientOnOpsApi(ctx: TenantContext, path: string): Response | null {
  if (ctx.role !== "Client") return null;
  logTenantDenial(ctx, "client role on operations API", path);
  return Response.json(
    { error: "Customer accounts use the client portal.", code: "client_audience" },
    { status: 403 },
  );
}
