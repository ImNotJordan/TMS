#!/usr/bin/env node
/**
 * Check the server principal's credentials and policy, without the app.
 *
 * Answers one question: can TITAN_AWS_* do the four things the server needs?
 * Running this separates "IAM is wrong" from "the app wiring is wrong", which
 * are otherwise indistinguishable from a 503.
 *
 * Reads .dev.vars directly, so it tests exactly what the Worker will use.
 *
 * Usage:
 *   node scripts/verify-server-principal.mjs
 */
import { readFileSync } from "node:fs";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
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

const accessKeyId = devVars.TITAN_AWS_ACCESS_KEY_ID;
const secretAccessKey = devVars.TITAN_AWS_SECRET_ACCESS_KEY;
const region = devVars.TITAN_AWS_REGION || appEnv.VITE_AWS_REGION || "us-west-1";
const settingsTable = appEnv.VITE_WORKSPACE_SETTINGS_TABLE_NAME || "WorkspaceSettings";
const profileTable = appEnv.VITE_PROFILE_TABLE_NAME || "UsersTable";
const userPoolId = appEnv.VITE_COGNITO_USER_POOL_ID;

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function describe(err) {
  const name = err?.name ?? "Error";
  if (name === "UnrecognizedClientException" || name === "InvalidClientTokenId") {
    return `${name}: the access key id is not valid`;
  }
  if (name === "SignatureDoesNotMatch") {
    return `${name}: the secret access key is wrong`;
  }
  if (name === "AccessDeniedException") {
    return `${name}: credentials are valid but the policy does not allow this`;
  }
  if (name === "ResourceNotFoundException") {
    return `${name}: that table does not exist in ${region}`;
  }
  return `${name}: ${err?.message ?? err}`;
}

async function main() {
  console.log("Server principal check\n");
  console.log(`  region           ${region}`);
  console.log(`  access key id    ${accessKeyId || "(missing)"}`);
  console.log(`  settings table   ${settingsTable}`);
  console.log(`  profile table    ${profileTable}`);
  console.log(`  user pool        ${userPoolId || "(missing)"}\n`);

  if (!accessKeyId || !secretAccessKey) {
    console.error("TITAN_AWS_ACCESS_KEY_ID / TITAN_AWS_SECRET_ACCESS_KEY missing from .dev.vars.");
    process.exit(1);
  }
  if (accessKeyId.length !== 20 || !accessKeyId.startsWith("AKIA")) {
    console.error(
      `Access key id looks malformed (${accessKeyId.length} chars). AWS uses exactly 20, starting "AKIA".`,
    );
    process.exit(1);
  }

  const credentials = { accessKeyId, secretAccessKey };
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region, credentials }));
  const idp = new CognitoIdentityProviderClient({ region, credentials });

  // 1. Read the secrets partition — how the server loads the OpenAI key.
  try {
    const out = await ddb.send(
      new GetCommand({
        TableName: settingsTable,
        Key: { scope: "secrets", section: "openai" },
      }),
    );
    const key = out.Item?.data?.apiKey;
    record(
      "dynamodb:GetItem on WorkspaceSettings (secrets)",
      true,
      key ? `OpenAI key present (…${String(key).slice(-4)})` : "no OpenAI key stored yet",
    );
  } catch (err) {
    record("dynamodb:GetItem on WorkspaceSettings (secrets)", false, describe(err));
  }

  // 2. Write to the secrets partition — how the settings endpoint saves.
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: settingsTable,
        Key: { scope: "secrets", section: "_healthcheck" },
        UpdateExpression: "SET checkedAt = :now",
        ExpressionAttributeValues: { ":now": new Date().toISOString() },
      }),
    );
    record("dynamodb:UpdateItem on WorkspaceSettings", true, "wrote secrets/_healthcheck");
  } catch (err) {
    record("dynamodb:UpdateItem on WorkspaceSettings", false, describe(err));
  }

  // 3. Read a Profile row — how role lookup works.
  try {
    await ddb.send(
      new GetCommand({
        TableName: profileTable,
        Key: { userId: "__healthcheck__", section: "permissions" },
      }),
    );
    record("dynamodb:GetItem on the Profile table", true, "readable");
  } catch (err) {
    record("dynamodb:GetItem on the Profile table", false, describe(err));
  }

  // 4. Cognito admin read — how company assignment finds the target user.
  if (!userPoolId) {
    record("cognito-idp:AdminGetUser", false, "VITE_COGNITO_USER_POOL_ID missing from .env");
  } else {
    try {
      await idp.send(
        new AdminGetUserCommand({ UserPoolId: userPoolId, Username: "__healthcheck__" }),
      );
      record("cognito-idp:AdminGetUser", true, "permitted");
    } catch (err) {
      // UserNotFound means the call was authorized — exactly what we want.
      if (err?.name === "UserNotFoundException") {
        record("cognito-idp:AdminGetUser", true, "permitted (test user absent, as expected)");
      } else {
        record("cognito-idp:AdminGetUser", false, describe(err));
      }
    }
  }

  // 5. The Loads table and both of its indexes — the API tier's data path.
  const loadsTable = appEnv.VITE_LOADS_TABLE_NAME || "Loads";
  for (const index of ["companyId-index", "assignedDriver-index"]) {
    const keyAttr = index === "companyId-index" ? "companyId" : "assignedDriver";
    try {
      await ddb.send(
        new QueryCommand({
          TableName: loadsTable,
          IndexName: index,
          KeyConditionExpression: `${keyAttr} = :v`,
          ExpressionAttributeValues: { ":v": "__healthcheck__" },
        }),
      );
      record(`dynamodb:Query on ${loadsTable}/${index}`, true, "permitted");
    } catch (err) {
      record(`dynamodb:Query on ${loadsTable}/${index}`, false, describe(err));
    }
  }

  // 6. Scan must NOT be permitted — the repository has no Scan path, so the
  //    principal behind it should not be able to enumerate a table either.
  try {
    await ddb.send(new ScanCommand({ TableName: loadsTable, Limit: 1 }));
    record(
      `dynamodb:Scan on ${loadsTable} is DENIED`,
      false,
      "Scan is allowed — remove it; leaving a migration grant behind defeats the point",
    );
  } catch (err) {
    const denied = err?.name === "AccessDeniedException";
    record(
      `dynamodb:Scan on ${loadsTable} is DENIED`,
      denied,
      denied ? "correctly denied" : describe(err),
    );
  }

  const failed = results.filter((r) => !r.ok);
  console.log("");
  if (failed.length === 0) {
    console.log("All checks passed. The server principal is correctly configured.");
    console.log("IAM -> titan user -> Security credentials -> Last used should now show a time.");
    return;
  }
  console.log(`${failed.length} check(s) failed.`);
  console.log("A single AccessDenied usually means the policy is attached to a different user,");
  console.log("or the table name in the policy ARN does not match .env.");
  process.exit(1);
}

main().catch((err) => {
  console.error("\nCheck failed to run:", err?.message ?? err);
  process.exit(1);
});
