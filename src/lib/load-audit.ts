/**
 * The record of who changed a load, and what they changed.
 *
 * ## Why enforcement was not enough
 *
 * Role checks now stop Sales from touching a rate and stop anyone touching a
 * delivered load's economics. What they do not do is leave a trace when the write
 * is *allowed*. A broker legitimately moving a customer rate from $2,850 to $1,900
 * on a live load produced no record at all: not who, not when, not what it was
 * before. Which meant that after the fact you could say "that could not have
 * happened" but never "here is what happened".
 *
 * A guard tells you a rule held. An audit row tells you what people actually did.
 * You need both, and the second is what you reach for when a customer disputes an
 * invoice or a margin quietly disappears.
 *
 * ## Server-owned, append-only
 *
 * Built here from the verified token, appended in the update expression, and
 * refused if a request tries to supply it. That is the same posture
 * `driverStatusHistory` ended up with, and for the same reason: the first version
 * of that field trusted client-supplied entries, and a driver back-dated one,
 * attributed it to someone else, and replaced the whole trail in a single request.
 * An audit trail the audited party can write is not an audit trail.
 *
 * ## Before-and-after, but only for money
 *
 * Every entry names the fields that changed. Economic fields additionally carry
 * their old and new values, because "the rate changed" is not the useful fact —
 * "the rate went from 2850 to 1900" is. Non-economic fields are named but not
 * valued: recording every address edit in full would bloat the item toward
 * DynamoDB's 400KB limit for no investigative benefit.
 */
import { LOAD_ECONOMIC_FIELDS } from "@/lib/tenant/load-permissions";
import type { TenantContext } from "@/lib/tenant/server-tenant-context";

/** One recorded change to a load. */
export type LoadAuditEntry = {
  at: string;
  /** Cognito subject of the caller. From the token, never the payload. */
  by: string;
  /** Their role at the time of the change; roles get reassigned. */
  role: string;
  /** How the change arrived. Distinguishes an ops edit from a driver report. */
  via: "ops-api" | "driver-api";
  /** Every attribute this write changed. */
  fields: string[];
  /** Old and new values, economic fields only. */
  rates?: Record<string, { from: unknown; to: unknown }>;
  /** Set when the write moved the load's lifecycle position. */
  statusChange?: { from: string | null; to: string };
};

/** Attributes never worth an audit entry of their own. */
const NOT_AUDITABLE: ReadonlySet<string> = new Set([
  "loadId",
  "updatedAt",
  "createdAt",
  "createdBy",
  "companyId",
  // Server-owned trails. Auditing the audit trail is circular.
  "loadAuditTrail",
  "driverStatusHistory",
  // High-churn telemetry: a GPS ping every few minutes would drown the trail.
  "driverGps",
  "trackingSession",
]);

/**
 * The audit entry for a patch, or `null` when nothing auditable changed.
 *
 * `current` is the stored record, read in the same request that performs the
 * write, so the "from" values are the ones actually being replaced rather than
 * whatever the client believed was there.
 */
export function buildLoadAuditEntry(args: {
  ctx: TenantContext;
  patch: Record<string, unknown>;
  current: Record<string, unknown>;
  via: LoadAuditEntry["via"];
  at?: string;
}): LoadAuditEntry | null {
  const { ctx, patch, current, via } = args;

  const changed = Object.keys(patch).filter((key) => {
    if (NOT_AUDITABLE.has(key)) return false;
    if (patch[key] === undefined) return false;
    // A no-op resend of an unchanged value is not a change. Editor screens PUT
    // whole records back, so without this every save would log forty fields.
    return JSON.stringify(patch[key]) !== JSON.stringify(current[key]);
  });
  if (changed.length === 0) return null;

  const rates: Record<string, { from: unknown; to: unknown }> = {};
  for (const field of changed) {
    if (LOAD_ECONOMIC_FIELDS.has(field)) {
      rates[field] = { from: current[field] ?? null, to: patch[field] };
    }
  }

  const entry: LoadAuditEntry = {
    at: args.at ?? new Date().toISOString(),
    by: ctx.userId,
    role: ctx.role ?? "(unassigned)",
    via,
    fields: changed,
  };
  if (Object.keys(rates).length > 0) entry.rates = rates;
  if (changed.includes("loadStatus")) {
    entry.statusChange = {
      from: (current.loadStatus as string | undefined) ?? null,
      to: patch.loadStatus as string,
    };
  }
  return entry;
}

/** Server-owned trails a request may never supply. */
export const SERVER_OWNED_LOAD_FIELDS = ["loadAuditTrail", "driverStatusHistory"] as const;
