#!/usr/bin/env node
/**
 * Copy the pre-tenant shared WorkspaceSettings rows onto ONE company.
 *
 * Settings used to live at `scope=global` and `scope=secrets` / `openai`.
 * Every company read those rows, so one tenant's API key was everyone else's.
 * The app now reads `<companyId>` and `secrets/<companyId>#kind` only.
 *
 * This script does not guess which company owned the shared keys. Pass the
 * company that should keep them. Other companies start empty and enter their
 * own keys in Settings. Copying the shared row onto every company would
 * recreate the leak.
 *
 * Dry run by default. Nothing is written without `--apply`.
 *
 * Usage:
 *   node scripts/migrate-workspace-settings-to-company.mjs --company-id <uuid>
 *   node scripts/migrate-workspace-settings-to-company.mjs --company-id <uuid> --apply
 */
import { readFileSync } from "node:fs";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

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

function parseArgs(argv) {
  const args = { apply: false, companyId: null };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--apply") args.apply = true;
    else if (token === "--company-id") args.companyId = argv[++i] ?? null;
  }
  return args;
}

const GLOBAL_SECTIONS = [
  "integrations",
  "appSettings",
  "automations",
  "webhooks",
  "orgStructure",
  "communications",
];
const SECRET_KINDS = ["openai", "avalara", "chinaTax"];

const args = parseArgs(process.argv);
if (!args.companyId?.trim()) {
  console.error(
    "Usage: node scripts/migrate-workspace-settings-to-company.mjs --company-id <uuid> [--apply]",
  );
  process.exit(1);
}

const companyId = args.companyId.trim();
if (companyId === "global" || companyId === "secrets") {
  console.error("That id is a reserved partition, not a company.");
  process.exit(1);
}

const devVars = parseEnvFile(".dev.vars");
const appEnv = parseEnvFile(".env");
const region = devVars.TITAN_AWS_REGION || appEnv.VITE_AWS_REGION || "us-west-1";
const settingsTable = appEnv.VITE_WORKSPACE_SETTINGS_TABLE_NAME || "WorkspaceSettings";

if (!devVars.TITAN_AWS_ACCESS_KEY_ID) {
  console.error("Missing TITAN_AWS_ACCESS_KEY_ID in .dev.vars");
  process.exit(1);
}

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    region,
    credentials: {
      accessKeyId: devVars.TITAN_AWS_ACCESS_KEY_ID,
      secretAccessKey: devVars.TITAN_AWS_SECRET_ACCESS_KEY,
    },
  }),
  { marshallOptions: { removeUndefinedValues: true } },
);

async function getItem(scope, section) {
  const out = await ddb.send(
    new GetCommand({ TableName: settingsTable, Key: { scope, section } }),
  );
  return out.Item ?? null;
}

async function writeRow(scope, section, data) {
  await ddb.send(
    new UpdateCommand({
      TableName: settingsTable,
      Key: { scope, section },
      UpdateExpression: "SET #data = :data, updatedAt = :now",
      ExpressionAttributeNames: { "#data": "data" },
      ExpressionAttributeValues: {
        ":data": data ?? {},
        ":now": new Date().toISOString(),
      },
    }),
  );
}

function describeSecret(item) {
  const data = item?.data ?? {};
  const key = typeof data.apiKey === "string" ? data.apiKey : "";
  const license = typeof data.licenseKey === "string" ? data.licenseKey : "";
  const token = key || license;
  if (!token) return "present, no key";
  return `present, last4 …${token.slice(-4)}`;
}

async function main() {
  console.log(`Company  ${companyId}`);
  console.log(`Table    ${settingsTable}`);
  console.log(args.apply ? "Mode     APPLY\n" : "Mode     dry run (pass --apply to write)\n");

  for (const section of GLOBAL_SECTIONS) {
    const source = await getItem("global", section);
    const dest = await getItem(companyId, section);
    if (!source) {
      console.log(`  skip  global/${section}  (empty)`);
      continue;
    }
    if (dest) {
      console.log(`  skip  global/${section} → ${companyId}/${section}  (destination already exists)`);
      continue;
    }
    console.log(`  copy  global/${section} → ${companyId}/${section}`);
    if (args.apply) {
      await writeRow(companyId, section, source.data ?? {});
    }
  }

  for (const kind of SECRET_KINDS) {
    const source = await getItem("secrets", kind);
    const destSection = `${companyId}#${kind}`;
    const dest = await getItem("secrets", destSection);
    if (!source) {
      console.log(`  skip  secrets/${kind}  (empty)`);
      continue;
    }
    if (dest) {
      console.log(`  skip  secrets/${kind} → secrets/${destSection}  (destination already exists)`);
      continue;
    }
    console.log(`  copy  secrets/${kind} → secrets/${destSection}  (${describeSecret(source)})`);
    if (args.apply) {
      await writeRow("secrets", destSection, source.data ?? {});
    }
  }

  console.log(
    args.apply
      ? "\nDone. Legacy global/secrets rows are unread by the app; rotate any key that was shared."
      : "\nDry run. Re-run with --apply to write. Do not run this for a second company — that copies the same keys again.",
  );
}

main().catch((err) => {
  console.error(err?.name ? `${err.name}: ${err.message}` : err);
  process.exit(1);
});
