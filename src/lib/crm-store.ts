import { createApiBackedStore } from "./api/api-backed-store";
import {
  getCrmAccountsTableName,
  getCrmActivitiesTableName,
  getCrmCampaignsTableName,
  getCrmContactsTableName,
  getCrmLeadsTableName,
  getCrmProspectingTableName,
} from "./dynamodb";
import type { OperationalListKind } from "./operational-data-cache";

type WithMeta = {
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
};

/**
 * Shared CRUD builder — every CRM entity has its own table but the same access
 * pattern, and now the same transport: `/api/crm-*`, scoped server-side.
 *
 * `tableName` is still accepted so the six call sites below did not have to
 * change; it is unused, because the server resolves the table from the resource
 * registry. The browser is not told which table backs a resource — it has no
 * permission to reach one directly and no need to know.
 */
function makeCrudStore<T extends WithMeta>(opts: {
  tableName: string;
  idKey: keyof T & string;
  label: string;
  kind: OperationalListKind;
  /** Resource segment and envelope keys, matching `resource-registry`. */
  api: { resource: string; collection: string; item: string };
}) {
  return createApiBackedStore<T>({
    resource: opts.api.resource,
    keys: { collection: opts.api.collection, item: opts.api.item },
    idKey: opts.idKey,
    kind: opts.kind,
  });
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export type CrmAccountType = "Shipper" | "Broker" | "Carrier" | "Other";
export type CrmAccountStatus = "Prospect" | "Active" | "Inactive";

export type CrmAccountRecord = WithMeta & {
  accountId: string;
  name: string;
  accountType?: CrmAccountType;
  status?: CrmAccountStatus;
  industry?: string;
  website?: string;
  phone?: string;
  email?: string;
  city?: string;
  state?: string;
  owner?: string;
  notes?: string;
  /** Optional FK into Carriers when accountType is Carrier/Broker. */
  carrierId?: string;
};

export type CreateCrmAccountInput = Omit<CrmAccountRecord, "createdAt" | "updatedAt">;

const accountsStore = makeCrudStore<CrmAccountRecord>({
  tableName: getCrmAccountsTableName(),
  idKey: "accountId",
  label: "CRM Accounts",
  kind: "crmAccounts",
  api: { resource: "crm-accounts", collection: "accounts", item: "account" },
});

export const createCrmAccount = accountsStore.create;
export const listAllCrmAccounts = accountsStore.listAll;
export const listAllCrmAccountsCached = accountsStore.listAllCached;
export const getCrmAccountById = accountsStore.getById;
export const getCrmAccountByIdCached = accountsStore.getByIdCached;
export const updateCrmAccount = accountsStore.update;
export const deleteCrmAccount = accountsStore.remove;

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

export type CrmContactRecord = WithMeta & {
  contactId: string;
  accountId?: string;
  firstName: string;
  lastName: string;
  title?: string;
  email?: string;
  phone?: string;
  mobilePhone?: string;
  isPrimary?: boolean;
  notes?: string;
};

export type CreateCrmContactInput = Omit<CrmContactRecord, "createdAt" | "updatedAt">;

const contactsStore = makeCrudStore<CrmContactRecord>({
  tableName: getCrmContactsTableName(),
  idKey: "contactId",
  label: "CRM Contacts",
  kind: "crmContacts",
  api: { resource: "crm-contacts", collection: "contacts", item: "contact" },
});

export const createCrmContact = contactsStore.create;
export const listAllCrmContacts = contactsStore.listAll;
export const listAllCrmContactsCached = contactsStore.listAllCached;
export const getCrmContactById = contactsStore.getById;
export const getCrmContactByIdCached = contactsStore.getByIdCached;
export const updateCrmContact = contactsStore.update;
export const deleteCrmContact = contactsStore.remove;

// ---------------------------------------------------------------------------
// Leads / Pipeline deals
// ---------------------------------------------------------------------------

export type CrmLeadStage = "Prospect" | "Quoted" | "Won" | "Lost";
export type CrmLeadSource = "dat_prospecting" | "referral" | "campaign" | "manual" | "inbound";

export const CRM_LEAD_STAGES: CrmLeadStage[] = ["Prospect", "Quoted", "Won", "Lost"];

export type CrmLeadRecord = WithMeta & {
  leadId: string;
  title: string;
  stage: CrmLeadStage;
  accountId?: string;
  contactId?: string;
  origin?: string;
  destination?: string;
  equipmentType?: string;
  quotedRate?: number;
  estimatedCost?: number;
  marginTargetPct?: number;
  marginFloorPct?: number;
  probabilityPct?: number;
  source?: CrmLeadSource;
  owner?: string;
  notes?: string;
};

export type CreateCrmLeadInput = Omit<CrmLeadRecord, "createdAt" | "updatedAt">;

const leadsStore = makeCrudStore<CrmLeadRecord>({
  tableName: getCrmLeadsTableName(),
  idKey: "leadId",
  label: "CRM Leads",
  kind: "crmLeads",
  api: { resource: "crm-leads", collection: "leads", item: "lead" },
});

export const createCrmLead = leadsStore.create;
export const listAllCrmLeads = leadsStore.listAll;
export const listAllCrmLeadsCached = leadsStore.listAllCached;
export const getCrmLeadById = leadsStore.getById;
export const getCrmLeadByIdCached = leadsStore.getByIdCached;
export const updateCrmLead = leadsStore.update;
export const deleteCrmLead = leadsStore.remove;

/** Projected revenue for a lead: quoted rate weighted by close probability (defaults to 100% for Won). */
export function crmLeadRevenueForecast(lead: CrmLeadRecord): number {
  const rate = lead.quotedRate ?? 0;
  if (lead.stage === "Won") return rate;
  if (lead.stage === "Lost") return 0;
  const probability = (lead.probabilityPct ?? 50) / 100;
  return rate * probability;
}

/** Realized or projected margin percent for a lead, given quoted rate vs. estimated cost. */
export function crmLeadMarginPct(lead: CrmLeadRecord): number | null {
  if (!lead.quotedRate || lead.estimatedCost == null) return null;
  if (lead.quotedRate <= 0) return null;
  return ((lead.quotedRate - lead.estimatedCost) / lead.quotedRate) * 100;
}

// ---------------------------------------------------------------------------
// Activities (timeline entries attached to a lead / account / contact)
// ---------------------------------------------------------------------------

export type CrmActivityEntityType = "lead" | "account" | "contact";
export type CrmActivityType =
  | "call"
  | "email"
  | "note"
  | "meeting"
  | "dat_search"
  | "stage_change"
  | "campaign";

export type CrmActivityRecord = WithMeta & {
  activityId: string;
  entityType: CrmActivityEntityType;
  entityId: string;
  type: CrmActivityType;
  subject: string;
  body?: string;
  outcome?: string;
  transcript?: string;
  datSearchUrl?: string;
  guardrailAllowed?: boolean;
  guardrailReason?: string;
};

export type CreateCrmActivityInput = Omit<CrmActivityRecord, "createdAt" | "updatedAt">;

const activitiesStore = makeCrudStore<CrmActivityRecord>({
  tableName: getCrmActivitiesTableName(),
  idKey: "activityId",
  label: "CRM Activities",
  kind: "crmActivities",
  api: { resource: "crm-activities", collection: "activities", item: "activity" },
});

export const createCrmActivity = activitiesStore.create;
export const listAllCrmActivities = activitiesStore.listAll;
export const listAllCrmActivitiesCached = activitiesStore.listAllCached;
export const getCrmActivityById = activitiesStore.getById;
export const getCrmActivityByIdCached = activitiesStore.getByIdCached;
export const updateCrmActivity = activitiesStore.update;
export const deleteCrmActivity = activitiesStore.remove;

/** Uses the session-cached activity list — avoids a fresh Scan every time a timeline opens. */
export async function listCrmActivitiesForEntity(
  entityType: CrmActivityEntityType,
  entityId: string,
  options?: { force?: boolean },
): Promise<CrmActivityRecord[]> {
  const all = await listAllCrmActivitiesCached({ force: options?.force });
  return all
    .filter((a) => a.entityType === entityType && a.entityId === entityId)
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

export type CrmCampaignType = "email_sequence" | "landing_page" | "social" | "content_studio";
export type CrmCampaignStatus = "draft" | "scheduled" | "active" | "paused" | "completed";

export type CrmCampaignStep = {
  order: number;
  delayDays: number;
  subject: string;
  body: string;
};

export type CrmCampaignRecord = WithMeta & {
  campaignId: string;
  name: string;
  type: CrmCampaignType;
  status: CrmCampaignStatus;
  audience?: string;
  content?: string;
  steps?: CrmCampaignStep[];
  scheduledAt?: string;
  notes?: string;
};

export type CreateCrmCampaignInput = Omit<CrmCampaignRecord, "createdAt" | "updatedAt">;

const campaignsStore = makeCrudStore<CrmCampaignRecord>({
  tableName: getCrmCampaignsTableName(),
  idKey: "campaignId",
  label: "CRM Campaigns",
  kind: "crmCampaigns",
  api: { resource: "crm-campaigns", collection: "campaigns", item: "campaign" },
});

export const createCrmCampaign = campaignsStore.create;
export const listAllCrmCampaigns = campaignsStore.listAll;
export const listAllCrmCampaignsCached = campaignsStore.listAllCached;
export const getCrmCampaignById = campaignsStore.getById;
export const getCrmCampaignByIdCached = campaignsStore.getByIdCached;
export const updateCrmCampaign = campaignsStore.update;
export const deleteCrmCampaign = campaignsStore.remove;

// ---------------------------------------------------------------------------
// Prospecting runs (DAT scan + call log batches)
// ---------------------------------------------------------------------------

export type CrmProspectingMatch = {
  matchId: string;
  broker: string;
  brokerPhone: string;
  lane: string;
  postedRate: number;
  equipmentType: string;
  callOutcome?:
    | "pending"
    | "verified_available"
    | "unavailable"
    | "negotiated"
    | "guardrail_blocked";
  negotiatedRate?: number;
  transcript?: string;
  guardrailAllowed?: boolean;
  guardrailReason?: string;
};

export type CrmProspectingRunRecord = WithMeta & {
  runId: string;
  originCity?: string;
  originState?: string;
  destCity?: string;
  destState?: string;
  equipmentType?: string;
  targetRatePerMile?: number;
  marginFloorPct?: number;
  estimatedCost?: number;
  datSearchUrl: string;
  matches: CrmProspectingMatch[];
};

export type CreateCrmProspectingRunInput = Omit<CrmProspectingRunRecord, "createdAt" | "updatedAt">;

const prospectingStore = makeCrudStore<CrmProspectingRunRecord>({
  tableName: getCrmProspectingTableName(),
  idKey: "runId",
  label: "CRM Prospecting Runs",
  kind: "crmProspecting",
  api: { resource: "crm-prospecting", collection: "runs", item: "run" },
});

export const createCrmProspectingRun = prospectingStore.create;
export const listAllCrmProspectingRuns = prospectingStore.listAll;
export const listAllCrmProspectingRunsCached = prospectingStore.listAllCached;
export const getCrmProspectingRunById = prospectingStore.getById;
export const getCrmProspectingRunByIdCached = prospectingStore.getByIdCached;
export const updateCrmProspectingRun = prospectingStore.update;
export const deleteCrmProspectingRun = prospectingStore.remove;
