#!/usr/bin/env node
/**
 * Diagnose how a user id maps onto a Cognito user.
 *
 * The company assignment endpoint has to turn the id the app carries (the
 * Cognito `sub`) into the `Username` the admin APIs key on. When that lookup
 * returns "User not found", this tells you which step failed and what the pool
 * actually contains — rather than leaving you to guess.
 *
 * Usage:
 *   node scripts/resolve-cognito-user.mjs                 # list a few users
 *   node scripts/resolve-cognito-user.mjs <userId>        # trace one id
 *
 * Uses the server principal from .dev.vars — the same credentials the endpoint
 * uses, so a permission problem shows up here too.
 */
import { readFileSync } from "node:fs";
import {
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from "@aws-sdk/client-cognito-identity-provider";

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

const region = devVars.TITAN_AWS_REGION || appEnv.VITE_AWS_REGION || "us-west-1";
const userPoolId = appEnv.VITE_COGNITO_USER_POOL_ID;

const client = new CognitoIdentityProviderClient({
  region,
  credentials: {
    accessKeyId: devVars.TITAN_AWS_ACCESS_KEY_ID,
    secretAccessKey: devVars.TITAN_AWS_SECRET_ACCESS_KEY,
  },
});

function attr(attributes, name) {
  return attributes?.find((a) => a.Name === name)?.Value ?? null;
}

async function listSome() {
  console.log(`Users in ${userPoolId} (first 10)\n`);
  try {
    const out = await client.send(new ListUsersCommand({ UserPoolId: userPoolId, Limit: 10 }));
    if (!out.Users?.length) {
      console.log("  (no users)");
      return;
    }
    for (const user of out.Users) {
      const sub = attr(user.Attributes, "sub");
      console.log(`  Username: ${user.Username}`);
      console.log(`  sub:      ${sub}`);
      console.log(`  email:    ${attr(user.Attributes, "email") ?? "-"}`);
      console.log(`  company:  ${attr(user.Attributes, "custom:companyId") ?? "(none)"}`);
      console.log(`  same?     ${user.Username === sub ? "Username === sub" : "DIFFERENT"}`);
      console.log("");
    }
  } catch (err) {
    console.error(`  FAILED: ${err?.name}: ${err?.message}`);
    if (err?.name === "AccessDeniedException") {
      console.error("  -> the policy is missing cognito-idp:ListUsers");
    }
    process.exitCode = 1;
  }
}

async function trace(userId) {
  console.log(`Tracing "${userId}" in ${userPoolId}\n`);

  console.log("1. AdminGetUser with the id as Username");
  try {
    const out = await client.send(
      new AdminGetUserCommand({ UserPoolId: userPoolId, Username: userId }),
    );
    console.log(`   FOUND — Username "${out.Username}"`);
    console.log(`   sub: ${attr(out.UserAttributes, "sub")}`);
    console.log(`   company: ${attr(out.UserAttributes, "custom:companyId") ?? "(none)"}`);
    return;
  } catch (err) {
    console.log(`   ${err?.name}`);
    if (err?.name === "AccessDeniedException") {
      console.log("   -> the policy is missing cognito-idp:AdminGetUser");
      process.exitCode = 1;
      return;
    }
    if (err?.name !== "UserNotFoundException") {
      console.log(`   -> unexpected: ${err?.message}`);
      process.exitCode = 1;
      return;
    }
  }

  console.log("\n2. ListUsers filtered by sub");
  try {
    const out = await client.send(
      new ListUsersCommand({
        UserPoolId: userPoolId,
        Filter: `sub = "${userId}"`,
        Limit: 1,
      }),
    );
    const user = out.Users?.[0];
    if (user?.Username) {
      console.log(`   FOUND — Username "${user.Username}"`);
      console.log(`   company: ${attr(user.Attributes, "custom:companyId") ?? "(none)"}`);
      console.log("\n   The endpoint should work. If it still 404s, the running server");
      console.log("   has not picked up the latest code — restart it.");
      return;
    }
    console.log("   no match");
  } catch (err) {
    console.log(`   ${err?.name}: ${err?.message}`);
    if (err?.name === "AccessDeniedException") {
      console.log("   -> the policy is missing cognito-idp:ListUsers");
    }
    process.exitCode = 1;
    return;
  }

  console.log("\n3. Neither route matched. Listing users so you can compare ids.\n");
  await listSome();
  console.log("If the id you passed is not a `sub` above, the admin screen is");
  console.log("routing on something else — tell me which value matches.");
  process.exitCode = 1;
}

async function main() {
  if (!userPoolId) {
    console.error("VITE_COGNITO_USER_POOL_ID missing from .env");
    process.exit(1);
  }
  if (!devVars.TITAN_AWS_ACCESS_KEY_ID) {
    console.error("TITAN_AWS_ACCESS_KEY_ID missing from .dev.vars");
    process.exit(1);
  }

  const userId = process.argv[2]?.trim();
  console.log(`region ${region}\n`);
  if (userId) await trace(userId);
  else await listSome();
}

main().catch((err) => {
  console.error("\nFailed:", err?.message ?? err);
  process.exit(1);
});
