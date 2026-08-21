/**
 * Public (non-secret) workspace integrations for one company.
 *
 * The Google Maps JS key is meant to run in the browser — restriction is HTTP
 * referrer in Google Cloud, not concealment. What this must not do is read the
 * legacy `global` row: that is every tenant's key, which is the leak we closed.
 */
import { GetCommand } from "@aws-sdk/lib-dynamodb";

import { companySettingsScope } from "@/lib/ai/settings-scopes";
import { getWorkspaceSettingsTable } from "@/lib/ai/server-aws";
import { getServerDataClient } from "@/lib/server/server-dynamo";

export type CompanyGoogleMaps = {
  apiKey: string;
};

function mapsFromIntegrations(data: unknown): CompanyGoogleMaps | null {
  if (!data || typeof data !== "object") return null;
  const googleMaps = (data as { googleMaps?: unknown }).googleMaps;
  if (!googleMaps || typeof googleMaps !== "object") return null;
  const row = googleMaps as { apiKey?: unknown; enabled?: unknown };
  const apiKey = typeof row.apiKey === "string" ? row.apiKey.trim() : "";
  if (!apiKey) return null;
  if (row.enabled === false) return null;
  return { apiKey };
}

/**
 * That company's Maps key, or `null` when they have not connected one.
 *
 * Failures read as disconnected rather than taking the dashboard down. A missing
 * key is a Settings job, not a 502 on every customer refresh.
 */
export async function readCompanyGoogleMaps(companyId: string): Promise<CompanyGoogleMaps | null> {
  try {
    const out = (await getServerDataClient().send(
      new GetCommand({
        TableName: getWorkspaceSettingsTable(),
        Key: { scope: companySettingsScope(companyId), section: "integrations" },
      }),
    )) as { Item?: { data?: unknown } };
    return mapsFromIntegrations(out.Item?.data);
  } catch (err) {
    console.warn(
      "[client-dashboard] company maps settings unread",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
