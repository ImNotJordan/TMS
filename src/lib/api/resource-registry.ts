/**
 * The tenant-scoped resources exposed over HTTP.
 *
 * Adding a table to this list gives it a full scoped CRUD API — list, get,
 * create, update, delete — with the tenant predicate, the mass-assignment
 * rejection and the 404-not-403 semantics already applied. There is no
 * per-resource handler to write and therefore no per-resource handler to get
 * wrong.
 *
 * That is the point of the registry rather than eleven copied files: the eleven
 * copies would drift, and the one that drifted would be the leak.
 *
 * ## Prerequisites for each entry
 *
 * 1. A `companyId-index` GSI on the table (partition key `companyId`).
 * 2. The table's ARN in the server principal's policy — table **and**
 *    `/index/*`. Regenerate with `scripts/render-iam-policies.mjs`.
 * 3. The table removed from `BROWSER_TABLES` in that same script, so the
 *    browser loses direct access once the client is switched.
 *
 * A resource listed here whose GSI does not exist yet fails loudly on first
 * list, rather than silently falling back to something unscoped.
 */
import { readServerEnv } from "@/lib/server-env";

export type ResourceSpec = {
  /** URL segment: `/api/<name>`. */
  name: string;
  /** Env var holding the table name, and the fallback if unset. */
  tableEnv: string;
  tableFallback: string;
  /** Partition key attribute. */
  idKey: string;
  /** Singular label for error messages. Never carries tenant data. */
  label: string;
  /** Response key: `{ [collectionKey]: [...] }` / `{ [itemKey]: {...} }`. */
  collectionKey: string;
  itemKey: string;
};

/** GSI every tenant-scoped table must carry. */
export const COMPANY_INDEX = "companyId-index";

const SPECS: ResourceSpec[] = [
  {
    name: "trucks",
    tableEnv: "VITE_TRUCKS_TABLE_NAME",
    tableFallback: "TruckBoard",
    idKey: "truckBoardId",
    label: "Truck",
    collectionKey: "trucks",
    itemKey: "truck",
  },
  {
    name: "carriers",
    tableEnv: "VITE_CARRIERS_TABLE_NAME",
    tableFallback: "Carriers",
    idKey: "carrierId",
    label: "Carrier",
    collectionKey: "carriers",
    itemKey: "carrier",
  },
  {
    name: "quotes",
    tableEnv: "VITE_QUOTES_TABLE_NAME",
    tableFallback: "Quotes",
    idKey: "quoteId",
    label: "Quote",
    collectionKey: "quotes",
    itemKey: "quote",
  },
  {
    name: "rfps",
    tableEnv: "VITE_RFPS_TABLE_NAME",
    tableFallback: "RFPs",
    idKey: "rfpId",
    label: "RFP",
    collectionKey: "rfps",
    itemKey: "rfp",
  },
  {
    name: "invoices",
    tableEnv: "VITE_INVOICES_TABLE_NAME",
    tableFallback: "Invoices",
    idKey: "invoiceId",
    label: "Invoice",
    collectionKey: "invoices",
    itemKey: "invoice",
  },
  {
    name: "crm-accounts",
    tableEnv: "VITE_CRM_ACCOUNTS_TABLE_NAME",
    tableFallback: "CrmAccounts",
    idKey: "accountId",
    label: "Account",
    collectionKey: "accounts",
    itemKey: "account",
  },
  {
    name: "crm-contacts",
    tableEnv: "VITE_CRM_CONTACTS_TABLE_NAME",
    tableFallback: "CrmContacts",
    idKey: "contactId",
    label: "Contact",
    collectionKey: "contacts",
    itemKey: "contact",
  },
  {
    name: "crm-leads",
    tableEnv: "VITE_CRM_LEADS_TABLE_NAME",
    tableFallback: "CrmLeads",
    idKey: "leadId",
    label: "Lead",
    collectionKey: "leads",
    itemKey: "lead",
  },
  {
    name: "crm-activities",
    tableEnv: "VITE_CRM_ACTIVITIES_TABLE_NAME",
    tableFallback: "CrmActivities",
    idKey: "activityId",
    label: "Activity",
    collectionKey: "activities",
    itemKey: "activity",
  },
  {
    name: "crm-campaigns",
    tableEnv: "VITE_CRM_CAMPAIGNS_TABLE_NAME",
    tableFallback: "CrmCampaigns",
    idKey: "campaignId",
    label: "Campaign",
    collectionKey: "campaigns",
    itemKey: "campaign",
  },
  {
    name: "risk-models",
    tableEnv: "VITE_RISK_MODELS_TABLE_NAME",
    tableFallback: "RiskModels",
    idKey: "id",
    label: "Risk model",
    collectionKey: "models",
    itemKey: "model",
  },
  {
    name: "crm-prospecting",
    tableEnv: "VITE_CRM_PROSPECTING_TABLE_NAME",
    tableFallback: "CrmProspectingRuns",
    idKey: "runId",
    label: "Prospecting run",
    collectionKey: "runs",
    itemKey: "run",
  },
];

const BY_NAME = new Map(SPECS.map((spec) => [spec.name, spec]));

export function resourceSpecs(): ResourceSpec[] {
  return SPECS;
}

export function findResourceSpec(name: string): ResourceSpec | undefined {
  return BY_NAME.get(name);
}

export function resourceTable(spec: ResourceSpec): string {
  return readServerEnv(spec.tableEnv) || spec.tableFallback;
}
