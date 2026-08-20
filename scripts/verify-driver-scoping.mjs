#!/usr/bin/env node
/**
 * Show who each company's admin can see in the user directory.
 *
 * Reads your real Cognito pool and Profile table under the server principal,
 * applies the same predicate the API applies, and prints the resulting
 * visibility matrix. The point is to answer "did the driver leak actually
 * close" with data rather than by clicking around.
 *
 * It also flags the two states that need action:
 *
 *   - a Driver with no employer recorded  -> invisible to everyone
 *   - a Driver carrying a companyId claim -> a Rule B violation
 *
 * Read-only. Writes nothing.
 *
 * Usage: node scripts/verify-driver-scoping.mjs
 */
import { readFileSync } from "node:fs";
import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { BatchGetCommand, DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

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

const region = devVars.TITAN_AWS_REGION || appEnv.VITE_AWS_REGION || "us-west-1";
const userPoolId = appEnv.VITE_COGNITO_USER_POOL_ID;
const table = appEnv.VITE_PROFILE_TABLE_NAME || appEnv.VITE_USERS_TABLE_NAME || "UsersTable";

if (!userPoolId) {
  console.error("VITE_COGNITO_USER_POOL_ID is not set in .env");
  process.exit(1);
}

const credentials = {
  accessKeyId: devVars.TITAN_AWS_ACCESS_KEY_ID,
  secretAccessKey: devVars.TITAN_AWS_SECRET_ACCESS_KEY,
};

const idp = new CognitoIdentityProviderClient({ region, credentials });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region, credentials }));

/** Mirrors TENANT_EXEMPT_ROLES. */
const DRIVER_KEYS = new Set(["driver"]);
const isDriver = (role) => DRIVER_KEYS.has(String(role ?? "").trim().toLowerCase());

/** Mirrors isVisibleInDirectory for a non-platform-admin viewer. */
function visibleTo(subject, viewerCompany) {
  if (!viewerCompany) return false;
  if (isDriver(subject.role)) return (subject.employerCompanyId ?? "").trim() === viewerCompany;
  const company = (subject.companyId ?? "").trim();
  if (!company) return true;
  return company === viewerCompany;
}

async function listPool() {
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
        email: attr("email") ?? "(no email)",
        claimCompanyId: attr("custom:companyId") ?? null,
      });
    }
    token = out.PaginationToken;
  } while (token);
  return users;
}

async function loadProfiles(subs) {
  const byUser = new Map();
  for (let i = 0; i < subs.length; i += 100) {
    let keys = subs.slice(i, i + 100).map((userId) => ({ userId, section: "permissions" }));
    let attempts = 0;
    while (keys.length && attempts < 4) {
      const out = await ddb.send(new BatchGetCommand({ RequestItems: { [table]: { Keys: keys } } }));
      for (const row of out.Responses?.[table] ?? []) {
        if (row.userId) byUser.set(row.userId, row.data ?? {});
      }
      keys = out.UnprocessedKeys?.[table]?.Keys ?? [];
      attempts += 1;
    }
  }
  return byUser;
}

function pad(s, n) {
  const str = String(s);
  return str.length >= n ? str.slice(0, n) : str + " ".repeat(n - str.length);
}

async function main() {
  console.log(`Directory visibility (${region}, pool ${userPoolId})\n`);

  const pool = await listPool();
  const profiles = await loadProfiles(pool.map((u) => u.sub));

  const rows = pool.map((u) => {
    const p = profiles.get(u.sub) ?? {};
    return {
      ...u,
      role: p.role ?? null,
      companyId: p.companyId ?? null,
      companyName: p.companyName ?? null,
      employerCompanyId: p.employerCompanyId ?? null,
      employerCompanyName: p.employerCompanyName ?? null,
    };
  });

  // Every company that appears anywhere, with a readable label.
  const companies = new Map();
  for (const r of rows) {
    if (r.companyId) companies.set(r.companyId, r.companyName ?? r.companyId);
    if (r.employerCompanyId)
      companies.set(r.employerCompanyId, r.employerCompanyName ?? r.employerCompanyId);
  }

  console.log(`  ${pad("USER", 30)}${pad("ROLE", 14)}${pad("COMPANY", 20)}EMPLOYER`);
  console.log(`  ${"-".repeat(78)}`);
  for (const r of rows) {
    console.log(
      `  ${pad(r.email, 30)}${pad(r.role ?? "(none)", 14)}${pad(r.companyId ?? "-", 20)}${r.employerCompanyId ?? "-"}`,
    );
  }

  console.log(`\n  Visibility matrix — what each company's admin sees:\n`);
  for (const [companyId, label] of companies) {
    const visible = rows.filter((r) => visibleTo(r, companyId));
    const drivers = visible.filter((r) => isDriver(r.role));
    console.log(`  ${label} (${companyId})`);
    console.log(`     ${visible.length} user(s), of which ${drivers.length} driver(s)`);
    for (const d of drivers) console.log(`       driver: ${d.email}`);
    const foreign = drivers.filter((d) => d.employerCompanyId !== companyId);
    if (foreign.length) {
      console.log(`     LEAK: ${foreign.length} driver(s) from another company`);
    }
    console.log();
  }

  // Actionable states.
  const orphans = rows.filter((r) => isDriver(r.role) && !r.employerCompanyId);
  const ruleBViolations = rows.filter((r) => isDriver(r.role) && r.claimCompanyId);

  let problems = 0;

  if (orphans.length) {
    problems += 1;
    console.log(`  ${orphans.length} driver(s) with no employer recorded — visible to nobody:`);
    for (const o of orphans) console.log(`     ${o.email}  (${o.sub})`);
    console.log(`  Fix: node scripts/backfill-driver-employer.mjs --company-id <id> --company-name "<name>" --apply\n`);
  }

  if (ruleBViolations.length) {
    problems += 1;
    console.log(`  RULE B VIOLATION — ${ruleBViolations.length} driver(s) carry a custom:companyId claim:`);
    for (const v of ruleBViolations) console.log(`     ${v.email}  claim=${v.claimCompanyId}`);
    console.log(`  These drivers can read that company's data. Clear the claim in the Admin screen.\n`);
  }

  const crossCompany = [...companies.keys()].some((c) =>
    rows.filter((r) => visibleTo(r, c)).some((r) => isDriver(r.role) && r.employerCompanyId !== c),
  );
  if (crossCompany) {
    problems += 1;
    console.log("  A driver is visible to a company that does not employ them.\n");
  }

  // Two companyIds sharing a display name are two separate tenants that look
  // like one in every screen, because the UI shows the name. Users assume they
  // are colleagues and cannot see each other's records.
  const byName = new Map();
  for (const [companyId, label] of companies) {
    const key = label.trim().toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), { companyId, label }]);
  }
  const duplicates = [...byName.values()].filter((group) => group.length > 1);

  if (duplicates.length) {
    problems += 1;
    console.log("  DUPLICATE COMPANY NAMES — separate tenants that look identical in the UI:\n");
    for (const group of duplicates) {
      console.log(`     "${group[0].label}" exists ${group.length} times:`);
      for (const { companyId } of group) {
        const members = rows.filter(
          (r) => r.companyId === companyId || r.employerCompanyId === companyId,
        );
        console.log(`       ${companyId}`);
        for (const m of members) console.log(`         - ${m.email} (${m.role ?? "no role"})`);
      }
      console.log(
        `     These users cannot see each other's loads, carriers, quotes or CRM.\n` +
          `     Pick the id to keep, then reassign the others in Admin > Users > Edit.\n`,
      );
    }
  }

  if (problems === 0) {
    console.log("  No cross-company driver visibility. No Rule B violations.");
    console.log("  No duplicate company names.");
  }
  process.exit(problems === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`\nFailed: ${err?.name ?? "Error"} — ${err?.message ?? err}`);
  if (err?.name === "AccessDeniedException") {
    console.error("The server principal needs cognito-idp:ListUsers and dynamodb:BatchGetItem.");
    console.error("Re-render and re-apply: node scripts/render-iam-policies.mjs <account-id>");
  }
  process.exit(1);
});
