/**
 * 12-hour driver-location digest.
 *
 * Runs from the Worker cron, not from a browser tab. A timer in Settings would
 * only fire while an admin had the page open; freight does not wait on that.
 *
 * For each company: Resend key (secrets partition) + recipients on the
 * Automations tab (appSettings). Both are required. The key never goes in the
 * email, the logs, or the status payload.
 */
import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

import { companySettingsScope } from "@/lib/ai/settings-scopes";
import { getWorkspaceSettingsTable } from "@/lib/ai/server-aws";
import { parseDigestEmails } from "@/lib/digest-emails";
import { isDriverGpsFresh, type DriverGpsPing } from "@/lib/driver-gps";
import { renderDriverLocationDigest, type DigestLoadRow } from "@/lib/driver-location-digest-mail";
import type { LoadRecord } from "@/lib/loads-store";
import { sendResendEmail } from "@/lib/resend-mail";
import { getServerDataClient } from "@/lib/server/server-dynamo";
import { readServerEnv } from "@/lib/server-env";
import {
  readResendSecretForCompany,
  stampResendDigestAt,
  type ResendSecret,
} from "@/lib/settings-resend";
import { listKnownCompanies } from "@/lib/tenant/known-companies";
import { isClientActiveLoad } from "@/lib/tenant/client-scope";

/** Cron can retry. Eleven hours keeps a double-fire from mailing twice. */
export const DIGEST_MIN_INTERVAL_MS = 11 * 60 * 60 * 1000;

export function digestIsDue(lastDigestAt: string | undefined, now: number): boolean {
  if (!lastDigestAt) return true;
  const at = Date.parse(lastDigestAt);
  if (!Number.isFinite(at)) return true;
  return now - at >= DIGEST_MIN_INTERVAL_MS;
}

export type DigestSkipReason =
  | "no_key"
  | "disabled"
  | "no_from"
  | "no_recipients"
  | "recent"
  | "send_failed";

export type DigestRunSummary = {
  considered: number;
  sent: number;
  skipped: Partial<Record<DigestSkipReason, number>>;
};

export type DigestCompany = { companyId: string; companyName: string };

export type DigestDeps = {
  listCompanies: () => Promise<DigestCompany[]>;
  readResend: (companyId: string) => Promise<ResendSecret | null>;
  readAppSettings: (companyId: string) => Promise<Record<string, unknown>>;
  listLoads: (companyId: string) => Promise<LoadRecord[]>;
  sendEmail: typeof sendResendEmail;
  stampDigest: (companyId: string, at: string) => Promise<void>;
  now: () => number;
};

function bump(summary: DigestRunSummary, reason: DigestSkipReason) {
  summary.skipped[reason] = (summary.skipped[reason] ?? 0) + 1;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function loadsTable(): string {
  return readServerEnv("VITE_LOADS_TABLE_NAME") || "Loads";
}

async function readAppSettingsForCompany(companyId: string): Promise<Record<string, unknown>> {
  const out = (await getServerDataClient().send(
    new GetCommand({
      TableName: getWorkspaceSettingsTable(),
      Key: { scope: companySettingsScope(companyId), section: "appSettings" },
    }),
  )) as { Item?: { data?: Record<string, unknown> } };
  return out.Item?.data ?? {};
}

async function listLoadsForCompany(companyId: string): Promise<LoadRecord[]> {
  const items: LoadRecord[] = [];
  let cursor: Record<string, unknown> | undefined;
  do {
    const page = (await getServerDataClient().send(
      new QueryCommand({
        TableName: loadsTable(),
        IndexName: "companyId-index",
        KeyConditionExpression: "companyId = :companyId",
        ExpressionAttributeValues: { ":companyId": companyId },
        ExclusiveStartKey: cursor,
      }),
    )) as { Items?: LoadRecord[]; LastEvaluatedKey?: Record<string, unknown> };
    if (page.Items?.length) items.push(...page.Items);
    cursor = page.LastEvaluatedKey;
  } while (cursor);
  return items;
}

function lane(load: LoadRecord): string {
  const origin = [load.pickupCity, load.pickupState].filter(Boolean).join(", ") || "Origin TBD";
  const dest =
    [load.deliveryCity, load.deliveryState].filter(Boolean).join(", ") || "Destination TBD";
  return `${origin} → ${dest}`;
}

function driverName(load: LoadRecord): string {
  return (
    load.trackingSession?.assignedDriverName?.trim() ||
    load.driverGps?.sharedByName?.trim() ||
    load.assignedDriver?.trim() ||
    "Unassigned"
  );
}

function digestGps(load: LoadRecord): DigestLoadRow["gps"] {
  const ping = load.driverGps;
  if (usablePing(ping)) {
    return {
      lat: ping.lat,
      lng: ping.lng,
      lastPingAt: ping.lastPingAt,
      fresh: isDriverGpsFresh(ping),
    };
  }
  const session = load.trackingSession?.gps;
  if (!session || session.source !== "driver") return null;
  const asPing: DriverGpsPing = {
    lat: session.location.lat,
    lng: session.location.lng,
    lastPingAt: session.lastPingAt,
  };
  if (!usablePing(asPing)) return null;
  return {
    lat: asPing.lat,
    lng: asPing.lng,
    lastPingAt: asPing.lastPingAt,
    fresh: isDriverGpsFresh(asPing),
  };
}

function usablePing(ping: DriverGpsPing | undefined | null): ping is DriverGpsPing {
  if (!ping) return false;
  if (!Number.isFinite(ping.lat) || !Number.isFinite(ping.lng)) return false;
  if (ping.lat === 0 && ping.lng === 0) return false;
  return Boolean(ping.lastPingAt);
}

export function projectDigestRows(loads: LoadRecord[]): DigestLoadRow[] {
  return loads.filter(isClientActiveLoad).map((load) => ({
    loadId: load.loadId,
    driverName: driverName(load),
    customer: load.customer?.trim() || "—",
    lane: lane(load),
    status: load.trackingSession?.trackingState || load.loadStatus || "unknown",
    gps: digestGps(load),
  }));
}

export function recipientsFromSettings(settings: Record<string, unknown>): string[] {
  const dedicated = parseDigestEmails(
    asString(settings.driver_location_digest_email),
    asString(settings.driver_location_digest_cc),
  );
  if (dedicated.length > 0) return dedicated;
  return parseDigestEmails(asString(settings.automation_default_audience));
}

export async function runCompanyDriverLocationDigest(
  company: DigestCompany,
  deps: DigestDeps,
): Promise<DigestSkipReason | "sent"> {
  const secret = await deps.readResend(company.companyId);
  const apiKey = secret?.apiKey?.trim() ?? "";
  if (!apiKey || secret?.enabled === false) return "no_key";

  const settings = await deps.readAppSettings(company.companyId);
  if (!asBool(settings.driver_location_digest_enabled, false)) return "disabled";

  const from = secret.fromEmail?.trim() ?? "";
  if (!from) return "no_from";

  const to = recipientsFromSettings(settings);
  if (to.length === 0) return "no_recipients";

  const now = deps.now();
  if (!digestIsDue(secret.lastDigestAt, now)) return "recent";

  const loads = await deps.listLoads(company.companyId);
  const rows = projectDigestRows(loads);
  const generatedAt = new Date(now).toISOString();
  const companyName =
    asString(settings.company_legal_name).trim() || company.companyName.trim() || "Your company";
  const mail = renderDriverLocationDigest(companyName, generatedAt, rows);

  const result = await deps.sendEmail({
    apiKey,
    from,
    to,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
  });
  if (!result.ok) {
    console.error("[driver-location-digest] send failed", {
      companyId: company.companyId,
      error: result.error,
    });
    return "send_failed";
  }

  await deps.stampDigest(company.companyId, generatedAt);
  return "sent";
}

export function defaultDigestDeps(): DigestDeps {
  return {
    listCompanies: () => listKnownCompanies(),
    readResend: readResendSecretForCompany,
    readAppSettings: readAppSettingsForCompany,
    listLoads: listLoadsForCompany,
    sendEmail: sendResendEmail,
    stampDigest: stampResendDigestAt,
    now: () => Date.now(),
  };
}

export async function runDriverLocationDigests(
  deps: DigestDeps = defaultDigestDeps(),
): Promise<DigestRunSummary> {
  const summary: DigestRunSummary = { considered: 0, sent: 0, skipped: {} };
  const companies = await deps.listCompanies();
  for (const company of companies) {
    summary.considered += 1;
    try {
      const outcome = await runCompanyDriverLocationDigest(company, deps);
      if (outcome === "sent") summary.sent += 1;
      else bump(summary, outcome);
    } catch (err) {
      bump(summary, "send_failed");
      console.error("[driver-location-digest] company failed", {
        companyId: company.companyId,
        error: err instanceof Error ? err.message : err,
      });
    }
  }
  console.info("[driver-location-digest] run complete", summary);
  return summary;
}

export function isDriverLocationDigestRequest(url: URL, method: string): boolean {
  return method === "POST" && url.pathname === "/api/internal/driver-location-digest";
}

/**
 * Manual fire for ops. Only exists when `TITAN_CRON_SECRET` is set — otherwise
 * the path 404s so it is not a thing to probe.
 */
export async function handleDriverLocationDigestRequest(request: Request): Promise<Response> {
  const secret = readServerEnv("TITAN_CRON_SECRET")?.trim() ?? "";
  if (!secret) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (token !== secret) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  let onlyCompany: string | undefined;
  try {
    const body = (await request.json().catch(() => null)) as { companyId?: unknown } | null;
    if (typeof body?.companyId === "string" && body.companyId.trim()) {
      onlyCompany = body.companyId.trim();
    }
  } catch {
    onlyCompany = undefined;
  }

  const deps = defaultDigestDeps();
  if (onlyCompany) {
    const companies = await deps.listCompanies();
    const match = companies.find((company) => company.companyId === onlyCompany);
    deps.listCompanies = async () =>
      match ? [match] : [{ companyId: onlyCompany!, companyName: "" }];
  }

  const summary = await runDriverLocationDigests(deps);
  return Response.json({ ok: true, ...summary });
}
