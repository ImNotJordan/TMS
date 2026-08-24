#!/usr/bin/env node
/**
 * Readiness check before cutting a table over to the API.
 *
 * Each API-backed table needs two things in place before the browser loses
 * direct access: a `companyId-index` GSI, and the server principal permitted to
 * query it. This probes both at once — a successful query proves the index is
 * Active *and* the policy grants it.
 *
 * Applying the browser policy before these pass takes access away from the
 * browser without giving the server a working replacement, which breaks the
 * screen in a way that looks like a code bug.
 *
 * Usage: node scripts/check-company-indexes.mjs
 */
import { readFileSync } from "node:fs";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";

function parseEnvFile(path) {
  const out = {};
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return out;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

const devVars = parseEnvFile(".dev.vars");
const appEnv = parseEnvFile(".env");

/**
 * API tables scoped by a `companyId-index` Query, with the env var naming each.
 *
 * TrackingMessages and BiddingWorkspace are served by the API but are not here:
 * their tenancy comes from the parent load and from the caller's own sub
 * respectively, so neither has — or needs — a company index.
 */
const TABLES = [
  ["Loads", "VITE_LOADS_TABLE_NAME"],
  ["TruckBoard", "VITE_TRUCKS_TABLE_NAME"],
  ["Carriers", "VITE_CARRIERS_TABLE_NAME"],
  ["Quotes", "VITE_QUOTES_TABLE_NAME"],
  ["RFPs", "VITE_RFPS_TABLE_NAME"],
  ["Invoices", "VITE_INVOICES_TABLE_NAME"],
  ["CrmAccounts", "VITE_CRM_ACCOUNTS_TABLE_NAME"],
  ["CrmContacts", "VITE_CRM_CONTACTS_TABLE_NAME"],
  ["CrmLeads", "VITE_CRM_LEADS_TABLE_NAME"],
  ["CrmActivities", "VITE_CRM_ACTIVITIES_TABLE_NAME"],
  ["CrmCampaigns", "VITE_CRM_CAMPAIGNS_TABLE_NAME"],
  ["CrmProspectingRuns", "VITE_CRM_PROSPECTING_TABLE_NAME"],
  ["RiskModels", "VITE_RISK_MODELS_TABLE_NAME"],
  ["InventoryItems", "VITE_INVENTORY_ITEMS_TABLE_NAME"],
  ["InventoryMovements", "VITE_INVENTORY_MOVEMENTS_TABLE_NAME"],
];

const region = devVars.TITAN_AWS_REGION || appEnv.VITE_AWS_REGION || "us-west-1";
const client = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    region,
    credentials: {
      accessKeyId: devVars.TITAN_AWS_ACCESS_KEY_ID,
      secretAccessKey: devVars.TITAN_AWS_SECRET_ACCESS_KEY,
    },
  }),
);

function diagnose(err) {
  switch (err?.name) {
    case "ValidationException":
      return "index missing or still building";
    case "ResourceNotFoundException":
      return "table not found in this region";
    case "AccessDeniedException":
      return "server policy does not grant this table";
    default:
      return `${err?.name}: ${err?.message?.slice(0, 60)}`;
  }
}

async function main() {
  if (!devVars.TITAN_AWS_ACCESS_KEY_ID) {
    console.error("TITAN_AWS_ACCESS_KEY_ID missing from .dev.vars");
    process.exit(1);
  }

  console.log(`companyId-index readiness (${region})\n`);
  const notReady = [];

  for (const [fallback, envVar] of TABLES) {
    const table = appEnv[envVar] || fallback;
    try {
      const out = await client.send(
        new QueryCommand({
          TableName: table,
          IndexName: "companyId-index",
          KeyConditionExpression: "companyId = :c",
          ExpressionAttributeValues: { ":c": "__readiness__" },
        }),
      );
      console.log(`  READY      ${table} (${out.Count ?? 0} matching)`);
    } catch (err) {
      console.log(`  NOT READY  ${table} — ${diagnose(err)}`);
      notReady.push(table);
    }
  }

  console.log("");
  if (notReady.length === 0) {
    console.log("All tables ready. Safe to apply the browser policy.");
    return;
  }
  console.log(`${notReady.length} table(s) not ready: ${notReady.join(", ")}`);
  console.log("Do NOT apply the browser policy yet — those screens would break.");
  process.exit(1);
}

main().catch((err) => {
  console.error("\nCheck failed:", err?.message ?? err);
  process.exit(1);
});
