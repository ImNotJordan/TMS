#!/usr/bin/env node
/**
 * Give existing Drivers an `employerCompanyId`.
 *
 * The admin directory now scopes Drivers by employer rather than by the
 * `companyId` they are forbidden to have. Drivers created before that field
 * existed have nothing recorded, and the predicate fails closed — so they are
 * invisible to every company, and visible only to a platform admin. This puts
 * them back on the right roster.
 *
 * Dry run by default. Nothing is written without `--apply`.
 *
 * Usage:
 *   node scripts/backfill-driver-employer.mjs --company-id <id> --company-name <name>
 *   node scripts/backfill-driver-employer.mjs --company-id <id> --company-name <name> --apply
 *   node scripts/backfill-driver-employer.mjs --company-id <id> --company-name <name> --only <sub>,<sub>
 *
 * Requires the temporary Scan grant: finding rows that *lack* a field is
 * exactly what an index cannot answer. Re-render the server policy without
 * `--with-migration-scan` when you are done.
 */
import { readFileSync } from "node:fs";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

function parseEnvFile(path) {
  try {
    const out = {};
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      out[trimmed.slice(0, eq).trim()] = trimmed
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
    }
    return out;
  } catch {
    return {};
  }
}

const devVars = parseEnvFile(".dev.vars");
const appEnv = parseEnvFile(".env");

function parseArgs(argv) {
  const args = { apply: false };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--apply") args.apply = true;
    else if (token === "--company-id") args.companyId = argv[++i];
    else if (token === "--company-name") args.companyName = argv[++i];
    else if (token === "--only") args.only = new Set((argv[++i] ?? "").split(",").filter(Boolean));
  }
  return args;
}

const args = parseArgs(process.argv);

if (!args.companyId || !args.companyName) {
  console.error(
    "Usage: node scripts/backfill-driver-employer.mjs --company-id <id> --company-name <name> [--only sub,sub] [--apply]",
  );
  console.error(
    "\nFind the company id in the Admin > Users screen, or in any assigned user's profile.",
  );
  process.exit(1);
}

const table = appEnv.VITE_PROFILE_TABLE_NAME || appEnv.VITE_USERS_TABLE_NAME || "UsersTable";
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

/** Roles that must not carry a companyId — mirrors TENANT_EXEMPT_ROLES. */
const DRIVER_ROLE_KEYS = new Set(["driver"]);

function isDriver(data) {
  const role = typeof data?.role === "string" ? data.role.trim().toLowerCase() : "";
  return DRIVER_ROLE_KEYS.has(role);
}

async function main() {
  console.log(`Driver employer backfill (${region})`);
  console.log(`  table        ${table}`);
  console.log(`  company      ${args.companyName} (${args.companyId})`);
  console.log(`  mode         ${args.apply ? "APPLY" : "dry run"}\n`);

  const candidates = [];
  let cursor;
  let scanned = 0;

  do {
    const out = await client.send(
      new ScanCommand({
        TableName: table,
        FilterExpression: "#section = :permissions",
        ExpressionAttributeNames: { "#section": "section" },
        ExpressionAttributeValues: { ":permissions": "permissions" },
        ...(cursor ? { ExclusiveStartKey: cursor } : {}),
      }),
    );
    for (const item of out.Items ?? []) {
      scanned += 1;
      const data = item.data ?? {};
      if (!isDriver(data)) continue;
      if (data.employerCompanyId) continue;
      if (args.only && !args.only.has(item.userId)) continue;
      candidates.push(item.userId);
    }
    cursor = out.LastEvaluatedKey;
  } while (cursor);

  console.log(`  scanned      ${scanned} permission rows`);
  console.log(`  drivers      ${candidates.length} with no employer recorded\n`);

  if (candidates.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  for (const userId of candidates) {
    if (!args.apply) {
      console.log(`  would set    ${userId}`);
      continue;
    }
    await client.send(
      new UpdateCommand({
        TableName: table,
        Key: { userId, section: "permissions" },
        UpdateExpression:
          "SET #data.#employerId = :id, #data.#employerName = :name, #updatedAt = :now",
        ExpressionAttributeNames: {
          "#data": "data",
          "#employerId": "employerCompanyId",
          "#employerName": "employerCompanyName",
          "#updatedAt": "updatedAt",
        },
        ExpressionAttributeValues: {
          ":id": args.companyId,
          ":name": args.companyName,
          ":now": new Date().toISOString(),
        },
        // Do not clobber an employer set since the scan started.
        ConditionExpression: "attribute_not_exists(#data.#employerId)",
      }),
    );
    console.log(`  set          ${userId}`);
  }

  if (!args.apply) {
    console.log(`\nDry run. Re-run with --apply to write ${candidates.length} row(s).`);
  } else {
    console.log(`\nDone. ${candidates.length} driver(s) now roster to ${args.companyName}.`);
  }
}

main().catch((err) => {
  console.error(`\nFailed: ${err?.name ?? "Error"} — ${err?.message ?? err}`);
  if (err?.name === "AccessDeniedException") {
    console.error(
      "The server principal needs dynamodb:Scan. Re-render the policy with --with-migration-scan.",
    );
  }
  process.exit(1);
});
