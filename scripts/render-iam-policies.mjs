#!/usr/bin/env node
/**
 * Print (or write) the two IAM policies with your AWS account id filled in.
 *
 * Two things cause "The policy failed legacy parsing", and both come from
 * hand-editing:
 *
 *   1. A leftover `<ACCOUNT_ID>` placeholder — `<` and `>` make the ARN invalid.
 *   2. Typographic quotes. Copying JSON out of rendered markdown or a chat
 *      window silently turns `"` into `"` and `"`, which the parser rejects.
 *
 * `--write` avoids both: the files land on disk as plain ASCII, and you copy
 * from a real editor rather than from rendered text.
 *
 * Usage:
 *   node scripts/render-iam-policies.mjs 123456789012
 *   node scripts/render-iam-policies.mjs 123456789012 --write
 *   node scripts/render-iam-policies.mjs 123456789012 --only server
 *
 * Find your account id: IAM console -> top-right account menu -> Account ID.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const REGION = "us-west-1";
const USER_POOL_ID = "us-west-1_1CZpzcipb";

/**
 * Tables that have moved behind the API tier.
 *
 * Move a table here when its client store switches to HTTP. It then appears in
 * the **server** principal's policy and disappears from the **browser** role's —
 * one edit, both sides, so the two can never disagree about who owns a table.
 *
 * Most need a `companyId-index` GSI before they are added — see
 * `INDEXED_API_TABLES` below for which, and why two of them do not.
 */
const API_TABLES = [
  "Loads",
  "TruckBoard",
  "Carriers",
  "Quotes",
  "RFPs",
  "Invoices",
  "CrmAccounts",
  "CrmContacts",
  "CrmLeads",
  "CrmActivities",
  "CrmCampaigns",
  "CrmProspectingRuns",
  "TrackingMessages",
  "RiskModels",
  "BiddingWorkspace",
];

/**
 * API tables scoped by a `companyId-index` Query — the ones
 * `check-company-indexes.mjs` must find READY.
 *
 * Two API tables are deliberately absent, because their tenancy is not a
 * company column:
 *
 * - **TrackingMessages** is keyed by `loadId` and inherits its tenancy from the
 *   load. The server authorizes the parent load, then queries the base table.
 * - **BiddingWorkspace** is keyed by `workspaceId`, which *is* the caller's
 *   Cognito sub, taken from the token. The partition key is the boundary.
 *
 * (Loads stays in the set — it has a company index like the rest, plus
 * `assignedDriver-index` for the driver path.)
 *
 * A table in this set without its GSI fails loudly on first list rather than
 * falling back to anything unscoped.
 */
const INDEXED_API_TABLES = API_TABLES.filter(
  (name) => !["TrackingMessages", "BiddingWorkspace"].includes(name),
);

/** Every tenant-scoped table, whichever side currently reaches it. */
const ALL_TABLES = [
  "Loads",
  "TruckBoard",
  "Carriers",
  "Quotes",
  "RFPs",
  "Invoices",
  "TrackingMessages",
  "RiskModels",
  "BiddingWorkspace",
  "CrmAccounts",
  "CrmContacts",
  "CrmLeads",
  "CrmActivities",
  "CrmCampaigns",
  "CrmProspectingRuns",
];

/** Still reached directly from the browser, plus the two shared tables. */
const BROWSER_TABLES = [
  ...ALL_TABLES.filter((name) => !API_TABLES.includes(name)),
  "UsersTable",
  "WorkspaceSettings",
];

/** Tables whose GSIs the browser still queries (createdBy-index). */
const TABLES_WITH_INDEXES = new Set(["Carriers"].filter((name) => !API_TABLES.includes(name)));

function table(account, name) {
  return `arn:aws:dynamodb:${REGION}:${account}:table/${name}`;
}

/**
 * TEMPORARY. The backfill must find rows that *lack* a `companyId`, which the
 * company index cannot return by definition — only a Scan can. The application
 * never issues one (the repository has no Scan path), so this comes off again as
 * soon as the migration is done.
 */
function migrationScanStatement(account) {
  return {
    Sid: "TemporaryMigrationScan",
    Effect: "Allow",
    Action: "dynamodb:Scan",
    Resource: `arn:aws:dynamodb:${REGION}:${account}:table/*`,
  };
}

function serverPolicy(account, withMigrationScan = false) {
  return {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "WorkspaceSettings",
        Effect: "Allow",
        Action: ["dynamodb:GetItem", "dynamodb:UpdateItem"],
        Resource: table(account, "WorkspaceSettings"),
      },
      {
        Sid: "ProfileTable",
        Effect: "Allow",
        Action: ["dynamodb:GetItem", "dynamodb:UpdateItem"],
        Resource: table(account, "UsersTable"),
      },
      {
        // ListUsers is needed to resolve a Cognito `sub` (what the app carries)
        // to a `Username` (what the admin APIs key on) — they differ in this
        // pool because email sign-in makes Cognito generate its own username.
        Sid: "CompanyAssignment",
        Effect: "Allow",
        Action: [
          "cognito-idp:AdminGetUser",
          "cognito-idp:AdminUpdateUserAttributes",
          "cognito-idp:ListUsers",
        ],
        Resource: `arn:aws:cognito-idp:${REGION}:${account}:userpool/${USER_POOL_ID}`,
      },
      {
        // Deliberately no dynamodb:Scan — the tenant repository has no Scan
        // path, so the principal backing it must not carry the permission.
        Sid: "ApiTableData",
        Effect: "Allow",
        Action: [
          "dynamodb:GetItem",
          "dynamodb:Query",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
        ],
        Resource: API_TABLES.flatMap((name) => [
          table(account, name),
          `${table(account, name)}/index/*`,
        ]),
      },
      ...(withMigrationScan ? [migrationScanStatement(account)] : []),
    ],
  };
}

function browserPolicy(account) {
  const resources = [];
  for (const name of BROWSER_TABLES) {
    resources.push(table(account, name));
    if (TABLES_WITH_INDEXES.has(name)) resources.push(`${table(account, name)}/index/*`);
  }

  return {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "OperationalTables",
        Effect: "Allow",
        Action: [
          "dynamodb:GetItem",
          "dynamodb:Query",
          "dynamodb:Scan",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
        ],
        Resource: resources,
      },
      {
        // Explicit Deny beats every Allow, including any attached elsewhere.
        Sid: "DenyWorkspaceSecrets",
        Effect: "Deny",
        Action: "dynamodb:*",
        Resource: [
          table(account, "WorkspaceSettings"),
          `${table(account, "WorkspaceSettings")}/index/*`,
        ],
        Condition: {
          "ForAnyValue:StringEquals": { "dynamodb:LeadingKeys": ["secrets"] },
        },
      },
      {
        // Interim. Still lets any signed-in user rewrite anyone's attributes —
        // narrowed to one pool, not fixed. Delete once create-user, password
        // reset and resend-invite move behind server endpoints.
        Sid: "CognitoAdminScopedToOwnPool",
        Effect: "Allow",
        Action: [
          "cognito-idp:ListUsers",
          "cognito-idp:AdminCreateUser",
          "cognito-idp:AdminGetUser",
          "cognito-idp:AdminUpdateUserAttributes",
          "cognito-idp:AdminSetUserPassword",
          "cognito-idp:AdminResetUserPassword",
        ],
        Resource: `arn:aws:cognito-idp:${REGION}:${account}:userpool/${USER_POOL_ID}`,
      },
    ],
  };
}

function main() {
  const [account, ...rest] = process.argv.slice(2);
  const onlyIndex = rest.indexOf("--only");
  const only = onlyIndex >= 0 ? rest[onlyIndex + 1] : null;
  const write = rest.includes("--write");
  const migrationScan = rest.includes("--with-migration-scan");

  if (!account || !/^\d{12}$/.test(account)) {
    console.error("Usage: node scripts/render-iam-policies.mjs <12-digit-account-id>\n");
    console.error("Your account id is 12 digits, no dashes.");
    console.error("Find it: IAM console -> top-right account menu -> Account ID.");
    process.exit(1);
  }

  const wanted = [
    { key: "server", name: "titan-server-settings", policy: serverPolicy(account, migrationScan) },
    { key: "browser", name: "titan-browser-authenticated", policy: browserPolicy(account) },
  ].filter((entry) => !only || entry.key === only);

  if (wanted.length === 0) {
    console.error(`Unknown --only value. Use "server" or "browser".`);
    process.exit(1);
  }

  const outDir = join(dirname(fileURLToPath(import.meta.url)), "iam");
  if (write) mkdirSync(outDir, { recursive: true });

  for (const entry of wanted) {
    const json = JSON.stringify(entry.policy, null, 2);
    // Parse what we are about to emit — a malformed document should fail here,
    // not after a round trip through the AWS console.
    JSON.parse(json);

    const attachTo =
      entry.key === "server"
        ? "IAM user  titan-worker"
        : "Identity Pool authenticated role (inline policy)";

    if (write) {
      const path = join(outDir, `${entry.name}.json`);
      // ASCII, LF, no BOM — the console's parser rejects typographic quotes,
      // which is what copying out of rendered markdown produces.
      writeFileSync(path, `${json}\n`, { encoding: "utf8" });
      console.log(`\nwrote  ${path}`);
      console.log(`  policy name:  ${entry.name}`);
      console.log(`  attach to:    ${attachTo}`);
      continue;
    }

    console.log(`\n${"=".repeat(70)}`);
    console.log(`Policy name:  ${entry.name}`);
    console.log(`Attach to:    ${attachTo}`);
    console.log("=".repeat(70));
    console.log(json);
  }

  console.log(`\n${"=".repeat(70)}`);
  console.log("Before applying the browser policy, confirm the company indexes are ACTIVE:");
  console.log(`  node scripts/check-company-indexes.mjs   (${INDEXED_API_TABLES.length} tables)`);
  console.log("Applying it first revokes browser access to a table the API cannot yet query.\n");
  if (write) {
    console.log("Open each file in your editor and copy from there.");
    console.log("Do not commit them — they contain your AWS account id.");
  } else {
    console.log("Copy each JSON block above into the IAM console -> JSON tab.");
    console.log("Run again with --write to get files instead (safer to copy from).");
  }
}

main();
