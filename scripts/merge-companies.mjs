#!/usr/bin/env node
/**
 * Merge one company into another.
 *
 * Two companies sharing a display name are two separate tenants. Users in each
 * cannot see the other's loads, carriers, quotes or CRM, and no screen reveals
 * the difference because every screen shows the name while records are keyed by
 * the id. Fixing it means moving every reference from the losing id to the
 * winning one.
 *
 * Three kinds of reference get moved:
 *
 *   1. `companyId` on records in each tenant-scoped table (found via the
 *      `companyId-index`, so no Scan is needed).
 *   2. `permissions.companyId` / `employerCompanyId` on user Profile rows.
 *   3. `custom:companyId` on the Cognito user, plus a session-epoch bump so the
 *      moved user's existing tokens stop being accepted.
 *
 * Cognito is done last. A user whose claim moves before their records do would
 * briefly see an empty workspace; the other order shows them the merged data as
 * soon as they re-authenticate.
 *
 * Dry run by default. Nothing is written without `--apply`.
 *
 * Usage:
 *   node scripts/merge-companies.mjs --from <losingId> --into <winningId>
 *   node scripts/merge-companies.mjs --from <losingId> --into <winningId> --apply
 */
import { readFileSync } from "node:fs";
import {
  AdminUpdateUserAttributesCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

function parseEnvFile(path) {
  try {
    const out = {};
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq === -1) continue;
      out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    }
    return out;
  } catch {
    return {};
  }
}

const dev = parseEnvFile(".dev.vars");
const app = parseEnvFile(".env");

function parseArgs(argv) {
  const args = { apply: false };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === "--apply") args.apply = true;
    else if (argv[i] === "--from") args.from = argv[++i];
    else if (argv[i] === "--into") args.into = argv[++i];
  }
  return args;
}

const args = parseArgs(process.argv);
if (!args.from || !args.into) {
  console.error("Usage: node scripts/merge-companies.mjs --from <losingId> --into <winningId> [--apply]");
  console.error("\nRun scripts/verify-driver-scoping.mjs first — it prints the ids and who is in each.");
  process.exit(1);
}
if (args.from === args.into) {
  console.error("--from and --into are the same company.");
  process.exit(1);
}

const region = dev.TITAN_AWS_REGION || app.VITE_AWS_REGION || "us-west-1";
const credentials = {
  accessKeyId: dev.TITAN_AWS_ACCESS_KEY_ID,
  secretAccessKey: dev.TITAN_AWS_SECRET_ACCESS_KEY,
};
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region, credentials }));
const idp = new CognitoIdentityProviderClient({ region, credentials });

const profileTable = app.VITE_PROFILE_TABLE_NAME || "UsersTable";
const userPoolId = app.VITE_COGNITO_USER_POOL_ID;

/** Tenant tables and their partition keys. Mirrors the resource registry. */
const TABLES = [
  [app.VITE_LOADS_TABLE_NAME || "Loads", "loadId"],
  [app.VITE_TRUCKS_TABLE_NAME || "TruckBoard", "truckBoardId"],
  [app.VITE_CARRIERS_TABLE_NAME || "Carriers", "carrierId"],
  [app.VITE_QUOTES_TABLE_NAME || "Quotes", "quoteId"],
  [app.VITE_RFPS_TABLE_NAME || "RFPs", "rfpId"],
  [app.VITE_INVOICES_TABLE_NAME || "Invoices", "invoiceId"],
  [app.VITE_CRM_ACCOUNTS_TABLE_NAME || "CrmAccounts", "accountId"],
  [app.VITE_CRM_CONTACTS_TABLE_NAME || "CrmContacts", "contactId"],
  [app.VITE_CRM_LEADS_TABLE_NAME || "CrmLeads", "leadId"],
  [app.VITE_CRM_ACTIVITIES_TABLE_NAME || "CrmActivities", "activityId"],
  [app.VITE_CRM_CAMPAIGNS_TABLE_NAME || "CrmCampaigns", "campaignId"],
  [app.VITE_CRM_PROSPECTING_TABLE_NAME || "CrmProspectingRuns", "runId"],
  [app.VITE_RISK_MODELS_TABLE_NAME || "RiskModels", "id"],
];

async function recordsInCompany(table, idKey) {
  const items = [];
  let startKey;
  do {
    const out = await ddb.send(
      new QueryCommand({
        TableName: table,
        IndexName: "companyId-index",
        KeyConditionExpression: "companyId = :c",
        ExpressionAttributeValues: { ":c": args.from },
        ...(startKey ? { ExclusiveStartKey: startKey } : {}),
      }),
    );
    for (const item of out.Items ?? []) {
      if (item[idKey] !== undefined) items.push(item[idKey]);
    }
    startKey = out.LastEvaluatedKey;
  } while (startKey);
  return items;
}

async function main() {
  console.log(`Merge companies (${region})`);
  console.log(`  from (losing)  ${args.from}`);
  console.log(`  into (winning) ${args.into}`);
  console.log(`  mode           ${args.apply ? "APPLY" : "dry run"}\n`);

  // 1. Records, table by table.
  let totalRecords = 0;
  const plan = [];
  for (const [table, idKey] of TABLES) {
    try {
      const ids = await recordsInCompany(table, idKey);
      if (ids.length) {
        plan.push({ table, idKey, ids });
        totalRecords += ids.length;
        console.log(`  ${String(ids.length).padStart(4)}  ${table}`);
      }
    } catch (err) {
      if (err?.name === "ResourceNotFoundException") continue;
      console.log(`     ?  ${table} — ${err?.name}: ${err?.message?.slice(0, 60)}`);
    }
  }
  if (totalRecords === 0) console.log("  (no records reference the losing company)");

  // 2. Users, from Cognito plus their Profile rows.
  const users = [];
  let token;
  do {
    const out = await idp.send(
      new ListUsersCommand({ UserPoolId: userPoolId, PaginationToken: token, Limit: 60 }),
    );
    for (const u of out.Users ?? []) {
      const attr = (n) => u.Attributes?.find((a) => a.Name === n)?.Value;
      const sub = attr("sub");
      if (!sub) continue;
      users.push({
        sub,
        username: u.Username,
        email: attr("email") ?? "(no email)",
        claimCompanyId: attr("custom:companyId") ?? null,
        sessionEpoch: attr("custom:sessionEpoch") ?? null,
      });
    }
    token = out.PaginationToken;
  } while (token);

  const affected = [];
  for (const user of users) {
    const out = await ddb.send(
      new (await import("@aws-sdk/lib-dynamodb")).GetCommand({
        TableName: profileTable,
        Key: { userId: user.sub, section: "permissions" },
      }),
    );
    const data = out.Item?.data ?? {};
    const viaProfile = data.companyId === args.from;
    const viaEmployer = data.employerCompanyId === args.from;
    const viaClaim = user.claimCompanyId === args.from;
    if (viaProfile || viaEmployer || viaClaim) {
      affected.push({ ...user, viaProfile, viaEmployer, viaClaim });
    }
  }

  console.log(`\n  ${affected.length} user(s) to move:`);
  for (const u of affected) {
    const how = [u.viaClaim && "claim", u.viaProfile && "profile", u.viaEmployer && "employer"]
      .filter(Boolean)
      .join(", ");
    console.log(`     ${u.email}  (${how})`);
  }

  if (!args.apply) {
    console.log(`\nDry run. Re-run with --apply to move ${totalRecords} record(s) and ${affected.length} user(s).`);
    return;
  }

  // 3. Records first, so a moved user finds their data already there.
  for (const { table, idKey, ids } of plan) {
    for (const id of ids) {
      await ddb.send(
        new UpdateCommand({
          TableName: table,
          Key: { [idKey]: id },
          UpdateExpression: "SET companyId = :into",
          ConditionExpression: "companyId = :from",
          ExpressionAttributeValues: { ":into": args.into, ":from": args.from },
        }),
      );
    }
    console.log(`  moved ${ids.length} in ${table}`);
  }

  // 4. Profile rows.
  for (const user of affected) {
    if (user.viaProfile) {
      await ddb.send(
        new UpdateCommand({
          TableName: profileTable,
          Key: { userId: user.sub, section: "permissions" },
          UpdateExpression: "SET #d.#c = :into",
          ExpressionAttributeNames: { "#d": "data", "#c": "companyId" },
          ExpressionAttributeValues: { ":into": args.into },
        }),
      );
    }
    if (user.viaEmployer) {
      await ddb.send(
        new UpdateCommand({
          TableName: profileTable,
          Key: { userId: user.sub, section: "permissions" },
          UpdateExpression: "SET #d.#e = :into",
          ExpressionAttributeNames: { "#d": "data", "#e": "employerCompanyId" },
          ExpressionAttributeValues: { ":into": args.into },
        }),
      );
    }
  }
  console.log(`  updated ${affected.length} profile row(s)`);

  // 5. Cognito last, with an epoch bump so stale tokens carrying the old
  //    company stop being accepted.
  for (const user of affected) {
    if (!user.viaClaim) continue;
    const nextEpoch = String(Math.max(Date.now(), Number(user.sessionEpoch ?? 0) + 1));
    try {
      await idp.send(
        new AdminUpdateUserAttributesCommand({
          UserPoolId: userPoolId,
          Username: user.username,
          UserAttributes: [
            { Name: "custom:companyId", Value: args.into },
            { Name: "custom:sessionEpoch", Value: nextEpoch },
          ],
        }),
      );
      console.log(`  moved claim for ${user.email}`);
    } catch (err) {
      console.error(`  FAILED claim for ${user.email}: ${err?.name} — ${err?.message}`);
    }
  }

  console.log("\nDone. Moved users must sign in again before the change takes effect for them.");
  console.log("Re-run scripts/verify-driver-scoping.mjs to confirm the duplicate is gone.");
}

main().catch((err) => {
  console.error(`\nFailed: ${err?.name ?? "Error"} — ${err?.message ?? err}`);
  if (err?.name === "AccessDeniedException") {
    console.error("The server principal needs Query on companyId-index and UpdateItem on each table.");
  }
  process.exit(1);
});
