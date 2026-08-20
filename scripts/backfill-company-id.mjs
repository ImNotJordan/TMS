#!/usr/bin/env node
/**
 * Backfill `companyId` onto records created before the tenant model existed.
 *
 * Those rows carry no tenant stamp, and the app treats an unstamped row as
 * belonging to nobody — they are invisible rather than visible to everyone.
 * That is deliberate (an unstamped row that matched every tenant would be the
 * exact leak this work prevents), but it means existing data stays hidden until
 * this runs.
 *
 * Safety properties:
 *   - Dry run by default. Nothing is written without `--apply`.
 *   - Idempotent. Every write is conditional on `attribute_not_exists(companyId)`,
 *     so a re-run cannot overwrite a row that already has an owner — including
 *     one assigned to a different company.
 *   - Resumable. Prints a resume token on interruption; pass it to `--start-key`.
 *   - Logs every mutation and reports before/after counts per table.
 *
 * Usage:
 *   node --env-file=.env scripts/backfill-company-id.mjs --company-id <uuid>
 *   node --env-file=.env scripts/backfill-company-id.mjs --company-id <uuid> --apply
 *
 * Options:
 *   --company-id <id>   Target company. Required. Take it from the assigned
 *                       company of a user in that company (Profile permissions).
 *   --tables a,b        Restrict to these tables. Default: all tenant tables.
 *   --apply             Perform writes. Omit for a dry run.
 *   --start-key <json>  Resume token printed by a previous interrupted run.
 *   --region <region>   Overrides AWS_REGION / VITE_AWS_REGION.
 *
 * Credentials come from `.dev.vars` (the server principal), falling back to the
 * standard AWS provider chain.
 *
 * NOTE: this needs `dynamodb:Scan` — finding rows that lack a `companyId` means
 * reading rows the company index cannot return by definition. The server
 * principal deliberately does not have Scan, because the application never needs
 * it. Grant it for the migration and take it away afterwards:
 *
 *     { "Effect": "Allow", "Action": "dynamodb:Scan",
 *       "Resource": "arn:aws:dynamodb:<REGION>:<ACCOUNT>:table/*" }
 *
 * A one-off migration is exactly the kind of thing a temporary grant is for.
 */
import { readFileSync } from "node:fs";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

/** Read `KEY=value` pairs from a dotenv-style file. Missing file is fine. */
function readEnvFile(path) {
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

const devVars = readEnvFile(".dev.vars");

/** Server principal from .dev.vars, else the ambient provider chain. */
function resolveCredentials() {
  const accessKeyId = devVars.TITAN_AWS_ACCESS_KEY_ID;
  const secretAccessKey = devVars.TITAN_AWS_SECRET_ACCESS_KEY;
  if (accessKeyId && secretAccessKey) {
    return { credentials: { accessKeyId, secretAccessKey } };
  }
  return {};
}

/** Tenant-scoped tables and their partition keys. */
const TENANT_TABLES = [
  { env: "VITE_LOADS_TABLE_NAME", fallback: "Loads", idKey: "loadId" },
  { env: "VITE_TRUCKS_TABLE_NAME", fallback: "TruckBoard", idKey: "truckBoardId" },
  { env: "VITE_CARRIERS_TABLE_NAME", fallback: "Carriers", idKey: "carrierId" },
  { env: "VITE_QUOTES_TABLE_NAME", fallback: "Quotes", idKey: "quoteId" },
  { env: "VITE_RFPS_TABLE_NAME", fallback: "RFPs", idKey: "rfpId" },
  { env: "VITE_INVOICES_TABLE_NAME", fallback: "Invoices", idKey: "invoiceId" },
  { env: "VITE_CRM_ACCOUNTS_TABLE_NAME", fallback: "CrmAccounts", idKey: "accountId" },
  { env: "VITE_CRM_CONTACTS_TABLE_NAME", fallback: "CrmContacts", idKey: "contactId" },
  { env: "VITE_CRM_LEADS_TABLE_NAME", fallback: "CrmLeads", idKey: "leadId" },
  { env: "VITE_CRM_ACTIVITIES_TABLE_NAME", fallback: "CrmActivities", idKey: "activityId" },
  { env: "VITE_CRM_CAMPAIGNS_TABLE_NAME", fallback: "CrmCampaigns", idKey: "campaignId" },
  { env: "VITE_CRM_PROSPECTING_TABLE_NAME", fallback: "CrmProspectingRuns", idKey: "runId" },
  { env: "VITE_RISK_MODELS_TABLE_NAME", fallback: "RiskModels", idKey: "id" },
  // TrackingMessages and BiddingWorkspace are absent on purpose: neither is
  // scoped by a companyId column, so neither has anything to backfill. Messages
  // inherit their tenancy from the parent load; a bidding workspace is keyed by
  // the owner's own Cognito sub.
];

function parseArgs(argv) {
  const args = { apply: false };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--apply") {
      args.apply = true;
    } else if (token === "--company-id") {
      args.companyId = argv[++i];
    } else if (token === "--tables") {
      args.tables = argv[++i]
        ?.split(",")
        .map((t) => t.trim())
        .filter(Boolean);
    } else if (token === "--start-key") {
      args.startKey = JSON.parse(argv[++i]);
    } else if (token === "--region") {
      args.region = argv[++i];
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  return args;
}

function resolveTables(selected) {
  return TENANT_TABLES.map((entry) => ({
    name: process.env[entry.env]?.trim() || entry.fallback,
    idKey: entry.idKey,
  })).filter((table) => !selected || selected.includes(table.name));
}

async function backfillTable(docClient, table, companyId, apply, startKey) {
  let cursor = startKey;
  let scanned = 0;
  let alreadyStamped = 0;
  let toStamp = 0;
  let written = 0;
  let skipped = 0;

  console.log(`\n── ${table.name} ${apply ? "(APPLY)" : "(dry run)"}`);

  do {
    let page;
    try {
      page = await docClient.send(
        new ScanCommand({
          TableName: table.name,
          ExclusiveStartKey: cursor,
        }),
      );
    } catch (err) {
      if (err?.name === "ResourceNotFoundException") {
        console.log(`   table not found — skipping`);
        return { scanned: 0, alreadyStamped: 0, toStamp: 0, written: 0, skipped: 0 };
      }
      if (err?.name === "AccessDeniedException") {
        console.error(`   ACCESS DENIED on ${table.name}.`);
        console.error("   The migration needs dynamodb:Scan, which the server principal");
        console.error("   deliberately lacks. Grant it temporarily, then remove it.");
        process.exit(1);
      }
      throw err;
    }

    const items = page.Items ?? [];
    scanned += items.length;

    for (const item of items) {
      const id = item[table.idKey];
      if (!id) {
        console.warn(`   ! row with no ${table.idKey} — skipped`);
        skipped += 1;
        continue;
      }
      if (item.companyId) {
        alreadyStamped += 1;
        continue;
      }

      toStamp += 1;
      if (!apply) {
        console.log(`   would stamp ${table.idKey}=${id}`);
        continue;
      }

      try {
        await docClient.send(
          new UpdateCommand({
            TableName: table.name,
            Key: { [table.idKey]: id },
            UpdateExpression: "SET companyId = :companyId",
            // Idempotent, and refuses to reassign a row that already has an owner.
            ConditionExpression: "attribute_not_exists(companyId)",
            ExpressionAttributeValues: { ":companyId": companyId },
          }),
        );
        written += 1;
        console.log(`   stamped ${table.idKey}=${id}`);
      } catch (err) {
        if (err?.name === "ConditionalCheckFailedException") {
          // Raced with another writer that stamped it first — correct outcome.
          skipped += 1;
          console.log(`   already owned, left alone: ${table.idKey}=${id}`);
          continue;
        }
        console.error(
          `   FAILED ${table.idKey}=${id}: ${err?.message ?? err}`,
          `\n   resume with --start-key '${JSON.stringify(cursor ?? {})}'`,
        );
        throw err;
      }
    }

    cursor = page.LastEvaluatedKey;
  } while (cursor);

  console.log(
    `   scanned ${scanned} · already stamped ${alreadyStamped} · needing stamp ${toStamp} · written ${written} · skipped ${skipped}`,
  );
  return { scanned, alreadyStamped, toStamp, written, skipped };
}

async function main() {
  const args = parseArgs(process.argv);

  if (!args.companyId) {
    console.error("--company-id is required.\n");
    console.error("Find it in the Profile table: the `permissions` section of any");
    console.error("user in the target company carries `companyId`.");
    process.exit(1);
  }

  const region =
    args.region ||
    devVars.TITAN_AWS_REGION ||
    process.env.AWS_REGION ||
    process.env.VITE_AWS_REGION ||
    process.env.VITE_COGNITO_REGION;
  if (!region) {
    console.error("No AWS region. Pass --region or set AWS_REGION.");
    process.exit(1);
  }

  const tables = resolveTables(args.tables);
  if (tables.length === 0) {
    console.error("No matching tables.");
    process.exit(1);
  }

  const docClient = DynamoDBDocumentClient.from(
    new DynamoDBClient({ region, ...resolveCredentials() }),
    { marshallOptions: { removeUndefinedValues: true } },
  );

  console.log(args.apply ? "APPLYING CHANGES" : "DRY RUN — no writes will be made");
  console.log(`region      ${region}`);
  console.log(`companyId   ${args.companyId}`);
  console.log(`tables      ${tables.map((t) => t.name).join(", ")}`);

  const totals = { scanned: 0, alreadyStamped: 0, toStamp: 0, written: 0, skipped: 0 };
  for (const table of tables) {
    const result = await backfillTable(docClient, table, args.companyId, args.apply, args.startKey);
    for (const key of Object.keys(totals)) totals[key] += result[key];
  }

  console.log("\n── totals");
  console.log(`   scanned          ${totals.scanned}`);
  console.log(`   already stamped  ${totals.alreadyStamped}`);
  console.log(`   needing stamp    ${totals.toStamp}`);
  console.log(`   written          ${totals.written}`);
  console.log(`   skipped          ${totals.skipped}`);

  if (!args.apply && totals.toStamp > 0) {
    console.log("\nRe-run with --apply to write these changes.");
  }
}

main().catch((err) => {
  console.error("\nBackfill failed:", err?.message ?? err);
  process.exit(1);
});
