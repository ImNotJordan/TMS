#!/usr/bin/env node
/**
 * Assign users to a company — the bootstrap for the tenant model.
 *
 * The app assigns a company when an admin creates a user. Users who existed
 * before that have none, which means they see nothing and can create nothing.
 * This script gets the first company on the board; after that, Add User covers
 * new joiners and (once built) the edit-user screen covers moves.
 *
 * Writes `companyId` + `companyName` into each user's `permissions` section in
 * the Profile table — the same place the app reads them from, and a section the
 * self-service profile UI is not allowed to write.
 *
 * Usage:
 *   # See who is assigned to what
 *   node --env-file=.env scripts/assign-company.mjs --list
 *
 *   # Dry run: put every unassigned user in a new company
 *   node --env-file=.env scripts/assign-company.mjs --all-unassigned --company-name "Acme Logistics"
 *
 *   # Do it
 *   node --env-file=.env scripts/assign-company.mjs --all-unassigned --company-name "Acme Logistics" --apply
 *
 *   # One user, into an existing company
 *   node --env-file=.env scripts/assign-company.mjs --user-id <sub> --company-id <uuid> --company-name "Acme Logistics" --apply
 *
 * Credentials come from the standard AWS provider chain — use an admin
 * principal, not the browser's Identity Pool role.
 */
import { randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

function parseArgs(argv) {
  const args = { apply: false, list: false, allUnassigned: false };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--apply") args.apply = true;
    else if (token === "--list") args.list = true;
    else if (token === "--all-unassigned") args.allUnassigned = true;
    else if (token === "--user-id") args.userId = argv[++i];
    else if (token === "--company-id") args.companyId = argv[++i];
    else if (token === "--company-name") args.companyName = argv[++i];
    else if (token === "--region") args.region = argv[++i];
    else throw new Error(`Unknown argument: ${token}`);
  }
  return args;
}

function profileTableName() {
  return (
    process.env.VITE_PROFILE_TABLE_NAME?.trim() ||
    process.env.TITAN_PROFILE_TABLE_NAME?.trim() ||
    "Profile"
  );
}

/** Every user's permissions + personal sections, keyed by userId. */
async function loadUsers(docClient, table) {
  const users = new Map();
  let cursor;

  do {
    const page = await docClient.send(
      new ScanCommand({ TableName: table, ExclusiveStartKey: cursor }),
    );
    for (const item of page.Items ?? []) {
      if (!item.userId) continue;
      const entry = users.get(item.userId) ?? {};
      if (item.section === "permissions") entry.permissions = item.data ?? {};
      if (item.section === "personal") entry.personal = item.data ?? {};
      users.set(item.userId, entry);
    }
    cursor = page.LastEvaluatedKey;
  } while (cursor);

  return users;
}

function describe(userId, entry) {
  const email = entry.personal?.email ?? "(no email)";
  const role = entry.permissions?.role ?? "(no role)";
  const company = entry.permissions?.companyName
    ? `${entry.permissions.companyName} [${entry.permissions.companyId}]`
    : "UNASSIGNED";
  return `${userId}  ${String(email).padEnd(32)} ${String(role).padEnd(20)} ${company}`;
}

async function main() {
  const args = parseArgs(process.argv);
  const region =
    args.region ||
    process.env.AWS_REGION ||
    process.env.VITE_AWS_REGION ||
    process.env.VITE_COGNITO_REGION;
  if (!region) {
    console.error("No AWS region. Pass --region or set AWS_REGION.");
    process.exit(1);
  }

  const table = profileTableName();
  const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
    marshallOptions: { removeUndefinedValues: true },
  });

  const users = await loadUsers(docClient, table);

  if (args.list) {
    console.log(`${users.size} user(s) in ${table}:\n`);
    for (const [userId, entry] of users) console.log("  " + describe(userId, entry));
    const unassigned = [...users.values()].filter((e) => !e.permissions?.companyId).length;
    console.log(`\n${unassigned} unassigned.`);
    return;
  }

  if (!args.companyName?.trim()) {
    console.error("--company-name is required (or use --list).");
    process.exit(1);
  }
  if (!args.userId && !args.allUnassigned) {
    console.error("Pass --user-id <sub> or --all-unassigned.");
    process.exit(1);
  }

  const companyName = args.companyName.trim();
  const companyId = args.companyId?.trim() || randomUUID();
  const minted = !args.companyId?.trim();

  const targets = args.userId
    ? [[args.userId, users.get(args.userId) ?? {}]]
    : [...users.entries()].filter(([, entry]) => !entry.permissions?.companyId);

  if (args.userId && !users.has(args.userId)) {
    console.error(`User ${args.userId} has no profile rows in ${table}.`);
    process.exit(1);
  }

  console.log(args.apply ? "APPLYING CHANGES" : "DRY RUN — no writes will be made");
  console.log(`table        ${table}`);
  console.log(`companyName  ${companyName}`);
  console.log(`companyId    ${companyId}${minted ? "  (newly minted)" : ""}`);
  console.log(`targets      ${targets.length} user(s)\n`);

  let written = 0;
  for (const [userId, entry] of targets) {
    if (!args.apply) {
      console.log(`  would assign ${describe(userId, entry)}`);
      continue;
    }
    // Two steps, because `SET data.companyId` fails when `data` does not exist
    // yet. Seed the map first, then write into it — both idempotent.
    await docClient.send(
      new UpdateCommand({
        TableName: table,
        Key: { userId, section: "permissions" },
        UpdateExpression: "SET #data = if_not_exists(#data, :empty)",
        ExpressionAttributeNames: { "#data": "data" },
        ExpressionAttributeValues: { ":empty": {} },
      }),
    );
    await docClient.send(
      new UpdateCommand({
        TableName: table,
        Key: { userId, section: "permissions" },
        UpdateExpression:
          "SET #data.companyId = :companyId, #data.companyName = :companyName, updatedAt = :now",
        ExpressionAttributeNames: { "#data": "data" },
        ExpressionAttributeValues: {
          ":companyId": companyId,
          ":companyName": companyName,
          ":now": new Date().toISOString(),
        },
      }),
    );
    written += 1;
    console.log(`  assigned ${userId}`);
  }

  console.log(
    `\n${args.apply ? `assigned ${written}` : `would assign ${targets.length}`} user(s).`,
  );
  if (!args.apply) console.log("Re-run with --apply to write.");
  else {
    console.log(`\ncompanyId for the backfill step: ${companyId}`);
    console.log("Assigned users must sign out and back in to pick up the change.");
  }
}

main().catch((err) => {
  console.error("\nAssignment failed:", err?.message ?? err);
  process.exit(1);
});
