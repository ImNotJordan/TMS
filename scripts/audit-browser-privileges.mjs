#!/usr/bin/env node
/**
 * Prove what a signed-in user's browser credentials can actually reach.
 *
 * Authenticates against Cognito as a real user, exchanges the ID token for
 * Identity Pool credentials — exactly what the browser holds — and then probes
 * the boundary. This is the difference between "the policy appears to grant X"
 * and "a logged-in user can do X right now".
 *
 * Read-only and non-destructive. The one write-shaped probe deliberately sends
 * an invalid parameter so it can distinguish AccessDenied (no permission) from
 * InvalidParameter (permission held) without changing anything.
 *
 * Usage:
 *   node scripts/audit-browser-privileges.mjs <email> <password>
 */
import { readFileSync } from "node:fs";
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  AdminUpdateUserAttributesCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { fromCognitoIdentityPool } from "@aws-sdk/credential-providers";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";

function parseEnvFile(path) {
  try {
    const out = {};
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq === -1) continue;
      out[t.slice(0, eq).trim()] = t
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
    }
    return out;
  } catch {
    return {};
  }
}

const app = parseEnvFile(".env");
const [, , email, password] = process.argv;

if (!email || !password) {
  console.error("Usage: node scripts/audit-browser-privileges.mjs <email> <password>");
  process.exit(1);
}

const region = app.VITE_AWS_REGION || "us-west-1";
const UserPoolId = app.VITE_COGNITO_USER_POOL_ID;
const ClientId = app.VITE_COGNITO_USER_POOL_CLIENT_ID || app.VITE_COGNITO_CLIENT_ID;
const IdentityPoolId = app.VITE_COGNITO_IDENTITY_POOL_ID;
const profileTable = app.VITE_PROFILE_TABLE_NAME || app.VITE_USERS_TABLE_NAME || "UsersTable";

const idp = new CognitoIdentityProviderClient({ region });

const results = [];
function record(severity, title, detail) {
  results.push({ severity, title, detail });
  console.log(`  [${severity}] ${title}`);
  if (detail) console.log(`      ${detail}`);
}

console.log(`Browser privilege audit — ${email}\n`);

// 1. Authenticate.
let idToken;
try {
  const auth = await idp.send(
    new InitiateAuthCommand({
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId,
      AuthParameters: { USERNAME: email, PASSWORD: password },
    }),
  );
  idToken = auth.AuthenticationResult?.IdToken;
  if (!idToken) throw new Error(`no token (challenge: ${auth.ChallengeName ?? "unknown"})`);
  console.log("  signed in OK\n");
} catch (err) {
  console.error(`  Could not sign in: ${err.name} — ${err.message}`);
  if (err.name === "InvalidParameterException" || err.name === "NotAuthorizedException") {
    console.error("  If USER_PASSWORD_AUTH is disabled on the app client, that is a good thing;");
    console.error("  this probe simply cannot run without it. Enable it temporarily or skip.");
  }
  process.exit(1);
}

// Decode claims (display only — the signature was already checked by Cognito).
const claims = JSON.parse(Buffer.from(idToken.split(".")[1], "base64").toString("utf8"));
console.log("  Token claims that matter:");
console.log(`    sub               ${claims.sub}`);
console.log(`    custom:companyId  ${claims["custom:companyId"] ?? "(absent)"}`);
console.log(`    cognito:groups    ${JSON.stringify(claims["cognito:groups"] ?? null)}`);
console.log(`    custom:sessionEpoch ${claims["custom:sessionEpoch"] ?? "(absent)"}\n`);

// 2. Exchange for Identity Pool credentials — what the browser actually holds.
// Same provider the app itself uses, so this is the real authenticated role.
const provider = `cognito-idp.${region}.amazonaws.com/${UserPoolId}`;
const browserCreds = fromCognitoIdentityPool({
  identityPoolId: IdentityPoolId,
  logins: { [provider]: idToken },
  clientConfig: { region },
});
console.log("  Exchanged for Identity Pool credentials.\n");
console.log("  Probing what those credentials can reach:\n");

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region, credentials: browserCreds }));

// PROBE 1 — read every user's profile row directly, bypassing /api/admin/users.
try {
  const out = await ddb.send(new ScanCommand({ TableName: profileTable, Limit: 200 }));
  const items = out.Items ?? [];
  const users = new Set(items.map((i) => i.userId).filter(Boolean));
  const emails = new Set();
  const companies = new Set();
  let auditRows = 0;
  for (const i of items) {
    const d = i.data ?? {};
    if (d.email) emails.add(d.email);
    if (d.companyId) companies.add(d.companyId);
    if (typeof i.section === "string" && i.section.startsWith("log-")) auditRows += 1;
  }
  record(
    "CRITICAL",
    `Scan of ${profileTable} succeeded from browser credentials`,
    `${items.length} rows, ${users.size} distinct users, ${emails.size} email addresses, ` +
      `${companies.size} companies, ${auditRows} audit-log rows. ` +
      `This bypasses /api/admin/users entirely.`,
  );
} catch (err) {
  if (err.name === "AccessDeniedException") {
    record("OK", `Scan of ${profileTable} is DENIED from the browser`, "");
  } else {
    record("ERROR", `Scan probe inconclusive: ${err.name}`, err.message?.slice(0, 120));
  }
}

// PROBE 2 — can the browser rewrite Cognito attributes (the tenant claim)?
// Sent with a deliberately invalid attribute name: AccessDenied means no
// permission, InvalidParameter means the permission is held. Nothing is written.
try {
  const idpAsBrowser = new CognitoIdentityProviderClient({ region, credentials: browserCreds });
  await idpAsBrowser.send(
    new AdminUpdateUserAttributesCommand({
      UserPoolId,
      Username: claims.sub,
      UserAttributes: [{ Name: "custom:__audit_probe_nonexistent", Value: "1" }],
    }),
  );
  record(
    "CRITICAL",
    "AdminUpdateUserAttributes is permitted from the browser",
    "unexpectedly accepted",
  );
} catch (err) {
  if (err.name === "AccessDeniedException") {
    record("OK", "AdminUpdateUserAttributes is DENIED from the browser", "");
  } else if (err.name === "InvalidParameterException" || err.name === "UserNotFoundException") {
    record(
      "CRITICAL",
      "AdminUpdateUserAttributes is PERMITTED from the browser",
      `Rejected only on the attribute name (${err.name}) — the permission itself is held. ` +
        `A signed-in user can set their own custom:companyId and read any company's data.`,
    );
  } else {
    record("ERROR", `Cognito probe inconclusive: ${err.name}`, err.message?.slice(0, 120));
  }
}

console.log("");
const critical = results.filter((r) => r.severity === "CRITICAL").length;
console.log(`  ${critical} critical finding(s) confirmed against the live system.`);
process.exit(critical > 0 ? 1 : 0);
