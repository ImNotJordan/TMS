#!/usr/bin/env node
/**
 * Seed one active load the client portal can actually see.
 *
 * Finds a Cognito user in the `client` group (or profile role `client`), reads
 * their company + assignedCustomers, stamps tax the same way ops save does,
 * and PutItem into Loads.
 *
 * Usage: node scripts/seed-client-portal-load.mjs
 */
import { readFileSync } from "node:fs";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  AdminListGroupsForUserCommand,
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

function attr(attributes, name) {
  return attributes?.find((a) => a.Name === name)?.Value ?? null;
}

function parseAssigned(raw) {
  if (Array.isArray(raw)) {
    return raw.map((v) => String(v).trim()).filter(Boolean);
  }
  if (typeof raw !== "string") return [];
  return raw
    .split(/[,;\n]/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function roundMoney(value) {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

const devVars = parseEnvFile(".dev.vars");
const appEnv = parseEnvFile(".env");
const region = devVars.TITAN_AWS_REGION || appEnv.VITE_AWS_REGION || "us-west-1";
const userPoolId = appEnv.VITE_COGNITO_USER_POOL_ID;
const profileTable = appEnv.VITE_PROFILE_TABLE_NAME || "UsersTable";
const loadsTable = appEnv.VITE_LOADS_TABLE_NAME || "Loads";
const settingsTable = appEnv.VITE_WORKSPACE_SETTINGS_TABLE_NAME || "WorkspaceSettings";

const credentials = {
  accessKeyId: devVars.TITAN_AWS_ACCESS_KEY_ID,
  secretAccessKey: devVars.TITAN_AWS_SECRET_ACCESS_KEY,
};

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region, credentials }),
  { marshallOptions: { removeUndefinedValues: true } },
);
const idp = new CognitoIdentityProviderClient({ region, credentials });

async function listAllUsers() {
  const users = [];
  let paginationToken;
  do {
    const out = await idp.send(
      new ListUsersCommand({ UserPoolId: userPoolId, Limit: 60, PaginationToken: paginationToken }),
    );
    users.push(...(out.Users ?? []));
    paginationToken = out.PaginationToken;
  } while (paginationToken);
  return users;
}

async function isClientUser(username, permissions) {
  const role = String(permissions?.role ?? "").toLowerCase();
  if (role === "client" || role === "customer") return true;
  try {
    const groups = await idp.send(
      new AdminListGroupsForUserCommand({ UserPoolId: userPoolId, Username: username }),
    );
    return (groups.Groups ?? []).some((g) => {
      const name = (g.GroupName ?? "").toLowerCase();
      return name === "client" || name === "customer";
    });
  } catch {
    return false;
  }
}

async function main() {
  if (!devVars.TITAN_AWS_ACCESS_KEY_ID) {
    console.error("Missing TITAN_AWS_ACCESS_KEY_ID in .dev.vars");
    process.exit(1);
  }

  const cognitoUsers = await listAllUsers();
  const clients = [];

  for (const user of cognitoUsers) {
    const sub = attr(user.Attributes, "sub");
    const email = attr(user.Attributes, "email");
    if (!sub) continue;
    const profile = await ddb.send(
      new GetCommand({ TableName: profileTable, Key: { userId: sub, section: "permissions" } }),
    );
    const permissions = profile.Item?.data ?? {};
    if (!(await isClientUser(user.Username, permissions))) continue;
    clients.push({
      sub,
      email,
      username: user.Username,
      companyId: permissions.companyId ?? attr(user.Attributes, "custom:companyId"),
      companyName: permissions.companyName,
      assignedCustomers: parseAssigned(permissions.assignedCustomers),
    });
  }

  if (clients.length === 0) {
    console.error("No Client users found. Create one in Admin with Customer Portal Template first.");
    process.exit(1);
  }

  const client = clients.find((c) => c.companyId && c.assignedCustomers.length > 0) ?? clients[0];
  console.log("Client account");
  console.log(`  email     ${client.email ?? client.username}`);
  console.log(`  company   ${client.companyName ?? "(none)"} ${client.companyId ?? ""}`);
  console.log(`  customers ${client.assignedCustomers.join(", ") || "(none)"}`);

  if (!client.companyId) {
    console.error("That client has no companyId. Assign the company, then re-run.");
    process.exit(1);
  }

  // Empty assignment is an empty dashboard. Stamp a shipper name so the load we
  // create is actually visible to this login.
  if (client.assignedCustomers.length === 0) {
    const fallback = "Oakwell Farms";
    await ddb.send(
      new UpdateCommand({
        TableName: profileTable,
        Key: { userId: client.sub, section: "permissions" },
        UpdateExpression: "SET #data.#assigned = :assigned, #updatedAt = :now",
        ExpressionAttributeNames: {
          "#data": "data",
          "#assigned": "assignedCustomers",
          "#updatedAt": "updatedAt",
        },
        ExpressionAttributeValues: {
          ":assigned": fallback,
          ":now": new Date().toISOString(),
        },
      }),
    );
    client.assignedCustomers = [fallback];
    console.log(`  assigned  ${fallback}  (was empty — portal would have shown nothing)`);
  }

  const settingsItem =
    (
      await ddb.send(
        new GetCommand({
          TableName: settingsTable,
          Key: { scope: client.companyId, section: "appSettings" },
        }),
      )
    ).Item ??
    (
      await ddb.send(
        new GetCommand({ TableName: settingsTable, Key: { scope: "global", section: "appSettings" } }),
      )
    ).Item;
  const appSettings = settingsItem?.data ?? {};
  const chinaBilled = 10000;
  const usInland = 2400;
  const chinaPercentRaw = Number(String(appSettings.tax_manual_cn_vat_percent ?? "").trim());
  const chinaPercent =
    appSettings.tax_manual_rates_enabled === true &&
    Number.isFinite(chinaPercentRaw) &&
    chinaPercentRaw > 0 &&
    chinaPercentRaw <= 30
      ? chinaPercentRaw
      : 9;
  const usPercentRaw = Number(String(appSettings.tax_manual_us_transport_percent ?? "").trim());
  const usPercent =
    appSettings.tax_manual_rates_enabled === true &&
    Number.isFinite(usPercentRaw) &&
    usPercentRaw > 0 &&
    usPercentRaw <= 30
      ? usPercentRaw
      : 4.712;
  const chinaTax = roundMoney(chinaBilled * (chinaPercent / 100));
  const usTax = roundMoney(usInland * (usPercent / 100));

  const now = new Date().toISOString();
  const loadId = `L-CLIENT-${Date.now().toString(36).toUpperCase()}`;
  const customer = client.assignedCustomers[0];
  const item = {
    loadId,
    companyId: client.companyId,
    createdAt: now,
    updatedAt: now,
    createdBy: "seed-client-portal-load",
    loadType: "OTR",
    loadStatus: "in-transit",
    customer,
    broker: client.companyName || "Titan Freight",
    equipmentType: "40ft Container",
    pickupFacility: "Waigaoqiao Terminal",
    pickupAddress: "Waigaoqiao Free Trade Zone",
    pickupCity: "Shanghai",
    pickupState: "Shanghai",
    pickupZip: "200137",
    pickupDate: now.slice(0, 10),
    deliveryFacility: "Port of Los Angeles",
    pickupInstructions: "Export container — China origin",
    deliveryAddress: "Berth 401, San Pedro",
    deliveryCity: "Los Angeles",
    deliveryState: "CA",
    deliveryZip: "90731",
    deliveryDate: now.slice(0, 10),
    commodityDescription: "China to US — dual tax check",
    weight: "18000",
    weightUnit: "kg",
    customerRate: String(chinaBilled),
    carrierRate: "8000",
    taxManualAmount: chinaTax.toFixed(2),
    taxCurrency: "CNY",
    taxManualSource: "estimator",
    taxManualNote: `China VAT ${chinaPercent}% on origin charge; US freight tax ${usPercent}% on inland leg.`,
    taxLines: [
      {
        country: "CN",
        label: "China VAT",
        amount: chinaTax.toFixed(2),
        currency: "CNY",
        source: "estimator",
        note: `${chinaPercent}% output VAT on the China origin charge (¥${chinaBilled}).`,
      },
      {
        country: "US",
        label: "US freight tax",
        amount: usTax.toFixed(2),
        currency: "USD",
        source: "estimator",
        note: `${usPercent}% on the US inland leg ($${usInland}).`,
      },
    ],
    trackingRequired: true,
  };

  await ddb.send(new PutCommand({ TableName: loadsTable, Item: item }));

  console.log("\nCreated load");
  console.log(`  loadId    ${loadId}`);
  console.log(`  lane      Shanghai, China → Los Angeles, CA`);
  console.log(`  customer  ${customer}`);
  console.log(`  billed    ¥${chinaBilled.toFixed(2)}`);
  console.log(`  China VAT ¥${chinaTax.toFixed(2)}`);
  console.log(`  US tax    $${usTax.toFixed(2)}`);
  console.log(`  status    ${item.loadStatus}`);
  console.log("\nOpen http://localhost:5175/ as that client. Ops API must be on :8080.");
}

main().catch((err) => {
  console.error(err?.name ? `${err.name}: ${err.message}` : err);
  process.exit(1);
});
