import { fetchAuthSession } from "aws-amplify/auth";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { queryAllItems, scanAllTableItems } from "@titan/aws-client";

import { configureAmplify, hasIdentityPool } from "./amplify";

export { queryAllItems, scanAllTableItems };

const region =
  (import.meta.env.VITE_AWS_REGION as string | undefined) ??
  (import.meta.env.VITE_COGNITO_REGION as string | undefined);

const profileTableName = import.meta.env.VITE_PROFILE_TABLE_NAME as string | undefined;
const loadsTableName = (import.meta.env.VITE_LOADS_TABLE_NAME as string | undefined) ?? "Loads";
const trucksTableName =
  (import.meta.env.VITE_TRUCKS_TABLE_NAME as string | undefined) ?? "TruckBoard";
const rfpsTableName = (import.meta.env.VITE_RFPS_TABLE_NAME as string | undefined) ?? "RFPs";
const quotesTableName = (import.meta.env.VITE_QUOTES_TABLE_NAME as string | undefined) ?? "Quotes";
const invoicesTableName =
  (import.meta.env.VITE_INVOICES_TABLE_NAME as string | undefined) ?? "Invoices";
const trackingMessagesTableName =
  (import.meta.env.VITE_TRACKING_MESSAGES_TABLE_NAME as string | undefined) ?? "TrackingMessages";
const riskModelsTableName =
  (import.meta.env.VITE_RISK_MODELS_TABLE_NAME as string | undefined) ?? "RiskModels";
const biddingWorkspaceTableName =
  (import.meta.env.VITE_BIDDING_WORKSPACE_TABLE_NAME as string | undefined) ?? "BiddingWorkspace";
const workspaceSettingsTableName =
  (import.meta.env.VITE_WORKSPACE_SETTINGS_TABLE_NAME as string | undefined) ?? "WorkspaceSettings";
const carriersTableName =
  (import.meta.env.VITE_CARRIERS_TABLE_NAME as string | undefined) ?? "Carriers";
const crmAccountsTableName =
  (import.meta.env.VITE_CRM_ACCOUNTS_TABLE_NAME as string | undefined) ?? "CrmAccounts";
const crmContactsTableName =
  (import.meta.env.VITE_CRM_CONTACTS_TABLE_NAME as string | undefined) ?? "CrmContacts";
const crmLeadsTableName =
  (import.meta.env.VITE_CRM_LEADS_TABLE_NAME as string | undefined) ?? "CrmLeads";
const crmActivitiesTableName =
  (import.meta.env.VITE_CRM_ACTIVITIES_TABLE_NAME as string | undefined) ?? "CrmActivities";
const crmCampaignsTableName =
  (import.meta.env.VITE_CRM_CAMPAIGNS_TABLE_NAME as string | undefined) ?? "CrmCampaigns";
const crmProspectingTableName =
  (import.meta.env.VITE_CRM_PROSPECTING_TABLE_NAME as string | undefined) ?? "CrmProspectingRuns";

export function getProfileTableName() {
  if (!profileTableName) {
    throw new Error("Missing VITE_PROFILE_TABLE_NAME. Add it to your .env to enable DynamoDB.");
  }
  return profileTableName;
}

export function getLoadsTableName() {
  return loadsTableName;
}

export function getTrucksTableName() {
  return trucksTableName;
}

export function getRfpsTableName() {
  return rfpsTableName;
}

export function getQuotesTableName() {
  return quotesTableName;
}

export function getInvoicesTableName() {
  return invoicesTableName;
}

export function isInvoicesConfigured() {
  return Boolean(region && invoicesTableName && hasIdentityPool());
}

export function getTrackingMessagesTableName() {
  if (!trackingMessagesTableName) {
    throw new Error(
      "Missing VITE_TRACKING_MESSAGES_TABLE_NAME. Add it to your .env to enable cloud messages.",
    );
  }
  return trackingMessagesTableName;
}

export function getRiskModelsTableName() {
  return riskModelsTableName;
}

export function getBiddingWorkspaceTableName() {
  return biddingWorkspaceTableName;
}

export function getWorkspaceSettingsTableName() {
  return workspaceSettingsTableName;
}

export function getCarriersTableName() {
  return carriersTableName;
}

export function isCarriersConfigured() {
  return Boolean(region && carriersTableName && hasIdentityPool());
}

export function getCrmAccountsTableName() {
  return crmAccountsTableName;
}

export function getCrmContactsTableName() {
  return crmContactsTableName;
}

export function getCrmLeadsTableName() {
  return crmLeadsTableName;
}

export function getCrmActivitiesTableName() {
  return crmActivitiesTableName;
}

export function getCrmCampaignsTableName() {
  return crmCampaignsTableName;
}

export function getCrmProspectingTableName() {
  return crmProspectingTableName;
}

export function isCrmConfigured() {
  return Boolean(region && crmAccountsTableName && hasIdentityPool());
}

export function isBiddingWorkspaceConfigured() {
  return Boolean(region && biddingWorkspaceTableName && hasIdentityPool());
}

export function isTrackingMessagesConfigured() {
  return Boolean(region && trackingMessagesTableName && hasIdentityPool());
}

export function getAwsRegion() {
  return region;
}

export function isDynamoResourceNotFound(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; message?: string };
  return (
    e.name === "ResourceNotFoundException" ||
    (typeof e.message === "string" && e.message.includes("Requested resource not found"))
  );
}

export function isDynamoAccessDenied(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; message?: string };
  return (
    e.name === "AccessDeniedException" ||
    (typeof e.message === "string" &&
      (e.message.includes("not authorized") || e.message.includes("Access Denied")))
  );
}

export function isRiskModelsConfigured() {
  return Boolean(region && riskModelsTableName && hasIdentityPool());
}

export function isDynamoConfigured() {
  return Boolean(region && profileTableName && hasIdentityPool());
}

export function isWorkspaceSettingsConfigured() {
  return Boolean(region && workspaceSettingsTableName && hasIdentityPool());
}

let cached: DynamoDBDocumentClient | null = null;
let cachedExpiry = 0;

/** Drop cached DocumentClient (call on sign-out / expired credentials). */
export function clearDynamoClientCache() {
  cached = null;
  cachedExpiry = 0;
}

function isExpiredCredentialError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; message?: string };
  const name = (e.name ?? "").toLowerCase();
  const message = (e.message ?? "").toLowerCase();
  return (
    name.includes("expiredtoken") ||
    name.includes("notauthorized") ||
    message.includes("expired") ||
    message.includes("security token")
  );
}

export async function getDynamoDocClient(): Promise<DynamoDBDocumentClient> {
  configureAmplify();
  if (!hasIdentityPool()) {
    throw new Error(
      "Cognito Identity Pool is not configured. Set VITE_COGNITO_IDENTITY_POOL_ID in .env.",
    );
  }
  if (!region) {
    throw new Error("Missing VITE_AWS_REGION in .env.");
  }

  const now = Date.now();
  if (cached && now < cachedExpiry - 60_000) return cached;

  const session = await fetchAuthSession();
  const credentials = session.credentials;
  if (!credentials) {
    clearDynamoClientCache();
    throw new Error(
      "No AWS credentials. Ensure the user is signed in and the Identity Pool trusts the User Pool client.",
    );
  }

  const client = new DynamoDBClient({
    region,
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      sessionToken: credentials.sessionToken,
      expiration: credentials.expiration,
    },
  });

  cached = DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true },
  });
  cachedExpiry = credentials.expiration ? credentials.expiration.getTime() : now + 30 * 60_000;
  return cached;
}

/** Run a Dynamo op; on expired STS credentials, clear cache and retry once. */
export async function withFreshDynamoClient<T>(
  task: (client: DynamoDBDocumentClient) => Promise<T>,
): Promise<T> {
  try {
    const client = await getDynamoDocClient();
    return await task(client);
  } catch (err) {
    if (!isExpiredCredentialError(err)) throw err;
    clearDynamoClientCache();
    const client = await getDynamoDocClient();
    return await task(client);
  }
}
