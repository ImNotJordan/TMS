import { getWorkspaceSetting, putWorkspaceSetting } from "./workspace-settings-store";

export type AutomationRuleRecord = {
  id: string;
  name: string;
  trigger: string;
  condition: string;
  action: string;
  audience: string;
  status: "Active" | "Paused" | "Draft";
  lastRunAt?: string;
  updatedAt: string;
};

export type WebhookEndpointRecord = {
  id: string;
  endpoint: string;
  events: string;
  status: "Active" | "Disabled";
  updatedAt: string;
};

export type OrgTeamRecord = {
  id: string;
  name: string;
  lead: string;
  focus: string;
};

export type OrgBranchRecord = {
  id: string;
  name: string;
  region: string;
  restricted: boolean;
};

export type OrgStructureData = {
  teams: OrgTeamRecord[];
  branches: OrgBranchRecord[];
};

export type AutomationsData = { rules: AutomationRuleRecord[] };
export type WebhooksData = { endpoints: WebhookEndpointRecord[] };

/** Empty defaults — org configures via Settings / Admin; never seed demo rows into Dynamo. */
export const DEFAULT_AUTOMATIONS: AutomationsData = { rules: [] };
export const DEFAULT_WEBHOOKS: WebhooksData = { endpoints: [] };
export const DEFAULT_ORG_STRUCTURE: OrgStructureData = { teams: [], branches: [] };

export async function loadAutomations(): Promise<AutomationsData> {
  const { data } = await getWorkspaceSetting<AutomationsData>("automations");
  if (data?.rules) return { rules: data.rules };
  return DEFAULT_AUTOMATIONS;
}

export async function saveAutomations(data: AutomationsData): Promise<void> {
  await putWorkspaceSetting("automations", data);
}

export async function loadWebhooks(): Promise<WebhooksData> {
  const { data } = await getWorkspaceSetting<WebhooksData>("webhooks");
  if (data?.endpoints) return { endpoints: data.endpoints };
  return DEFAULT_WEBHOOKS;
}

export async function saveWebhooks(data: WebhooksData): Promise<void> {
  await putWorkspaceSetting("webhooks", data);
}

export async function loadOrgStructure(): Promise<OrgStructureData> {
  const { data } = await getWorkspaceSetting<OrgStructureData>("orgStructure");
  if (data) {
    return {
      teams: data.teams ?? [],
      branches: data.branches ?? [],
    };
  }
  return DEFAULT_ORG_STRUCTURE;
}

export async function saveOrgStructure(data: OrgStructureData): Promise<void> {
  await putWorkspaceSetting("orgStructure", data);
}

/** Kept for call-site compatibility; does not write demo data. */
export async function ensureWorkspaceOpsSeeded() {
  // no-op
}
