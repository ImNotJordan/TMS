#!/usr/bin/env node
/**
 * Seed a load that has already walked the live tracking path:
 *
 *   dispatch creates → assigns a real driver → driver accepts →
 *   driver advances to en-route-delivery → driver shares GPS
 *
 * That is the only combination both maps will plot:
 *   - Ops `/tracking` refuses a load with no `assignedDriver`
 *   - The client portal strips simulated GPS; it only shows `driverGps`
 *     (or `trackingSession.gps` with `source: "driver"`) less than 15 minutes old
 *
 * Lane is a real produce corridor so Google geocode + the tracking map agree:
 *   Oakwell Farms packing shed, Salinas CA → LA Wholesale Produce Market
 *   Truck currently southbound on US-101 near Santa Maria
 *
 * Usage:
 *   node scripts/seed-tracking-scenario.mjs
 *   node scripts/seed-tracking-scenario.mjs --refresh-gps
 *   node scripts/seed-tracking-scenario.mjs --refresh-gps --load-id L-TRACK-…
 *
 * `--refresh-gps` bumps `lastPingAt` (and eases the truck a few miles south).
 * Live GPS is treated as stale after 15 minutes — re-run this when the pin vanishes.
 */
import { readFileSync } from "node:fs";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  AdminListGroupsForUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";

const LOAD_PREFIX = "L-TRACK-";
const DRIVER_GPS_FRESH_MS = 15 * 60 * 1000;

/** Packing shed — Salinas / Spreckels. Google geocodes this corridor cleanly. */
const PICKUP = {
  facility: "Oakwell Farms Packing Shed",
  address: "Spreckels Boulevard",
  city: "Salinas",
  state: "CA",
  zip: "93901",
  lat: 36.6544,
  lng: -121.6544,
};

/** Real wholesale produce market. */
const DELIVERY = {
  facility: "Los Angeles Wholesale Produce Market",
  address: "1601 East Olympic Boulevard",
  city: "Los Angeles",
  state: "CA",
  zip: "90021",
  lat: 34.0353,
  lng: -118.243,
};

/**
 * US-101 southbound at Santa Maria — between pickup and delivery, not a hashed
 * inland pin. Heading ~155° is 101 toward LA.
 */
const SANTA_MARIA = { lat: 34.953, lng: -120.4357 };
const MILES_TOTAL = 325;
const ROUTE_PROGRESS_PCT = 43;

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

function minutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function towardLosAngeles(from, fraction) {
  const t = Math.min(1, Math.max(0, fraction));
  return {
    lat: roundCoord(lerp(from.lat, DELIVERY.lat, t)),
    lng: roundCoord(lerp(from.lng, DELIVERY.lng, t)),
  };
}

function roundCoord(n) {
  return Math.round(n * 1e6) / 1e6;
}

function parseArgs(argv) {
  const args = { refreshGps: false, loadId: null };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--refresh-gps") args.refreshGps = true;
    else if (token === "--load-id") args.loadId = argv[++i] ?? null;
  }
  return args;
}

function synthesizeName(personal, email, sub) {
  const given = String(personal?.given_name ?? "").trim();
  const family = String(personal?.family_name ?? "").trim();
  const nick = String(personal?.nickname ?? "").trim();
  const joined = [given, family].filter(Boolean).join(" ");
  if (joined) return joined;
  if (nick) return nick;
  const local = String(email ?? "").split("@")[0]?.trim();
  if (local) return local.replace(/[._]/g, " ");
  return sub;
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

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region, credentials }), {
  marshallOptions: { removeUndefinedValues: true },
});
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

async function profileSection(sub, section) {
  const out = await ddb.send(
    new GetCommand({ TableName: profileTable, Key: { userId: sub, section } }),
  );
  return out.Item?.data ?? {};
}

async function inGroup(username, names) {
  try {
    const groups = await idp.send(
      new AdminListGroupsForUserCommand({ UserPoolId: userPoolId, Username: username }),
    );
    return (groups.Groups ?? []).some((g) => names.has((g.GroupName ?? "").toLowerCase()));
  } catch {
    return false;
  }
}

async function findActors() {
  const cognitoUsers = await listAllUsers();
  const clients = [];
  const drivers = [];

  for (const user of cognitoUsers) {
    const sub = attr(user.Attributes, "sub");
    const email = attr(user.Attributes, "email") ?? user.Username;
    if (!sub) continue;
    const permissions = await profileSection(sub, "permissions");
    const personal = await profileSection(sub, "personal");
    const role = String(permissions?.role ?? "").toLowerCase();
    const name = synthesizeName(personal, email, sub);

    const isClient =
      role === "client" ||
      role === "customer" ||
      (await inGroup(user.Username, new Set(["client", "customer"])));
    if (isClient) {
      clients.push({
        sub,
        email,
        username: user.Username,
        name,
        companyId: permissions.companyId ?? attr(user.Attributes, "custom:companyId"),
        companyName: permissions.companyName,
        assignedCustomers: parseAssigned(permissions.assignedCustomers),
      });
    }

    const isDriver = role === "driver" || (await inGroup(user.Username, new Set(["driver"])));
    if (isDriver) {
      drivers.push({
        sub,
        email,
        username: user.Username,
        name,
        employerCompanyId: permissions.employerCompanyId ?? null,
        employerCompanyName: permissions.employerCompanyName ?? null,
      });
    }
  }

  return { clients, drivers };
}

async function ensureClientCustomers(client) {
  if (client.assignedCustomers.length > 0) return client;
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
  return client;
}

async function latestScenarioLoad(companyId, loadId) {
  if (loadId) {
    const got = await ddb.send(new GetCommand({ TableName: loadsTable, Key: { loadId } }));
    return got.Item ?? null;
  }
  const out = await ddb.send(
    new QueryCommand({
      TableName: loadsTable,
      IndexName: "companyId-index",
      KeyConditionExpression: "companyId = :cid",
      ExpressionAttributeValues: { ":cid": companyId },
    }),
  );
  const matches = (out.Items ?? [])
    .filter((item) => String(item.loadId ?? "").startsWith(LOAD_PREFIX))
    .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
  return matches[0] ?? null;
}

function buildHistory(driver, events) {
  return events.map((event) => ({
    status: event.status,
    at: event.at,
    serverAt: event.at,
    by: driver.sub,
    byName: driver.name,
    source: "driver-app",
  }));
}

function loc(stop, label) {
  return { lat: stop.lat, lng: stop.lng, city: stop.city, state: stop.state, label };
}

function buildTimeline(loadId, driver, dispatcherName, gps, stamps) {
  const pickup = loc(PICKUP, `${PICKUP.city}, ${PICKUP.state}`);
  const rolling = {
    lat: gps.lat,
    lng: gps.lng,
    city: "Santa Maria",
    state: "CA",
    label: `${driver.name} (live)`,
  };
  return [
    {
      id: `${loadId}-assigned`,
      action: "driver-assigned",
      state: "driver-assigned",
      timestamp: stamps.assigned,
      location: pickup,
      user: dispatcherName,
      source: "dispatcher",
      notes: `${driver.name} assigned to ${loadId}.`,
    },
    {
      id: `${loadId}-accept`,
      action: "accept-load",
      state: "driver-accepted",
      timestamp: stamps.accepted,
      location: pickup,
      user: driver.name,
      source: "driver-app",
      notes: `${driver.name} accepted the load.`,
    },
    {
      id: `${loadId}-enroute-pu`,
      action: "start-route-pickup",
      state: "en-route-pickup",
      timestamp: stamps.enRoutePickup,
      location: pickup,
      user: driver.name,
      source: "driver-app",
      notes: "Headed to Oakwell packing shed.",
    },
    {
      id: `${loadId}-arrive-pu`,
      action: "arrived-pickup",
      state: "at-pickup",
      timestamp: stamps.atPickup,
      location: pickup,
      user: driver.name,
      source: "driver-app",
      notes: "On the dock at Salinas.",
    },
    {
      id: `${loadId}-loaded`,
      action: "loaded",
      state: "at-pickup",
      timestamp: stamps.loaded,
      location: pickup,
      user: driver.name,
      source: "driver-app",
      notes: "48,000 lb mixed produce sealed.",
    },
    {
      id: `${loadId}-depart`,
      action: "in-transit",
      state: "in-transit",
      timestamp: stamps.inTransit,
      location: rolling,
      user: driver.name,
      source: "driver-app",
      notes: "Departed Salinas, southbound US-101.",
    },
  ];
}

function buildSession({ loadId, driver, dispatcherName, customer, gps, stamps, now }) {
  const milesRemaining = Math.round((1 - ROUTE_PROGRESS_PCT / 100) * MILES_TOTAL);
  const etaHours = milesRemaining / 58;
  return {
    loadId,
    trackingState: "in-transit",
    assignedDriverId: driver.sub,
    assignedDriverName: driver.name,
    dispatcherName,
    isActive: true,
    pickup: {
      city: PICKUP.city,
      state: PICKUP.state,
      facility: PICKUP.facility,
      address: PICKUP.address,
      date: stamps.pickupDate,
    },
    delivery: {
      city: DELIVERY.city,
      state: DELIVERY.state,
      facility: DELIVERY.facility,
      address: DELIVERY.address,
      date: stamps.deliveryDate,
    },
    equipment: "53ft Reefer",
    commodity: "Mixed produce — lettuce, berries, packed vegetables",
    customer,
    createdAt: stamps.created,
    updatedAt: now,
    startedAt: stamps.enRoutePickup,
    acceptedAt: stamps.accepted,
    customerTrackingLink: `https://track.logistics.app/t/${loadId}`,
    routeProgressPct: ROUTE_PROGRESS_PCT,
    milesTotal: MILES_TOTAL,
    milesRemaining,
    eta: new Date(Date.now() + etaHours * 60 * 60 * 1000).toISOString(),
    gps: {
      location: {
        lat: gps.lat,
        lng: gps.lng,
        city: "Santa Maria",
        state: "CA",
        label: `${driver.name} (live)`,
      },
      speedMph: 58,
      headingDeg: 155,
      lastPingAt: now,
      source: "driver",
      accuracyM: 9,
    },
    geofence: { pickupArrivedAt: stamps.atPickup },
    timeline: buildTimeline(loadId, driver, dispatcherName, gps, stamps),
    alerts: [
      {
        id: `${loadId}-gps`,
        title: "Driver GPS sharing",
        detail: `${driver.name} is sharing a live location from the driver portal.`,
        tone: "info",
        timestamp: now,
      },
    ],
    documentMeta: [
      {
        id: `${loadId}-rate`,
        name: "Rate confirmation",
        type: "Rate Conf.",
        status: "Received",
        uploadedAt: stamps.created,
      },
    ],
  };
}

function printWhereToLook(loadId, client, driver) {
  const staleMins = Math.round(DRIVER_GPS_FRESH_MS / 60000);
  console.log("\nWhere to look");
  console.log(`  Ops tracking     http://localhost:8080/tracking?loadId=${loadId}`);
  console.log("  Client portal    http://localhost:5175/   (map pin is the live GPS)");
  console.log(`  Client login     ${client.email}`);
  console.log(`  Driver portal    this load is assigned to ${driver.email}`);
  console.log(
    `\nLive GPS is treated as stale after ${staleMins} minutes. If the pin disappears:`,
  );
  console.log(`  node scripts/seed-tracking-scenario.mjs --refresh-gps --load-id ${loadId}`);
}

async function refreshGps(item) {
  const now = new Date().toISOString();
  const current = item.driverGps ?? item.trackingSession?.gps?.location ?? SANTA_MARIA;
  const from = {
    lat: Number(current.lat),
    lng: Number(current.lng),
  };
  const next = towardLosAngeles(from, 0.12);
  const driverName =
    item.trackingSession?.assignedDriverName ?? item.driverGps?.sharedByName ?? "Driver";

  const driverGps = {
    lat: next.lat,
    lng: next.lng,
    accuracyM: 9,
    speedMph: 57,
    headingDeg: 148,
    lastPingAt: now,
    serverAt: now,
    sharedBy: item.assignedDriver,
    sharedByName: driverName,
  };

  const session = item.trackingSession
    ? {
        ...item.trackingSession,
        updatedAt: now,
        gps: {
          ...item.trackingSession.gps,
          location: {
            ...(item.trackingSession.gps?.location ?? {}),
            lat: next.lat,
            lng: next.lng,
            label: `${driverName} (live)`,
          },
          lastPingAt: now,
          source: "driver",
          speedMph: 57,
          headingDeg: 148,
          accuracyM: 9,
        },
      }
    : undefined;

  await ddb.send(
    new UpdateCommand({
      TableName: loadsTable,
      Key: { loadId: item.loadId },
      UpdateExpression:
        "SET driverGps = :gps, updatedAt = :now" + (session ? ", trackingSession = :session" : ""),
      ExpressionAttributeValues: {
        ":gps": driverGps,
        ":now": now,
        ...(session ? { ":session": session } : {}),
      },
    }),
  );

  console.log("Refreshed live GPS");
  console.log(`  loadId    ${item.loadId}`);
  console.log(`  ping      ${next.lat}, ${next.lng}  (eased south toward LA)`);
  console.log(`  lastPing  ${now}`);
  console.log("  source    driver  — client portal will plot this");
}

async function createScenario({ client, driver, dispatcherName }) {
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
  const billed = 4200;
  const usPercentRaw = Number(String(appSettings.tax_manual_us_transport_percent ?? "").trim());
  const usPercent =
    appSettings.tax_manual_rates_enabled === true &&
    Number.isFinite(usPercentRaw) &&
    usPercentRaw > 0 &&
    usPercentRaw <= 30
      ? usPercentRaw
      : 4.712;
  const usTax = roundMoney(billed * (usPercent / 100));

  const now = new Date().toISOString();
  const pickupDate = minutesAgo(240).slice(0, 10);
  const deliveryDate = now.slice(0, 10);
  const stamps = {
    created: minutesAgo(250),
    assigned: minutesAgo(240),
    accepted: minutesAgo(228),
    enRoutePickup: minutesAgo(220),
    atPickup: minutesAgo(175),
    loaded: minutesAgo(155),
    inTransit: minutesAgo(140),
    pickupDate,
    deliveryDate,
  };

  const loadId = `${LOAD_PREFIX}${Date.now().toString(36).toUpperCase()}`;
  const customer = client.assignedCustomers[0];
  const gps = SANTA_MARIA;
  const session = buildSession({
    loadId,
    driver,
    dispatcherName,
    customer,
    gps,
    stamps,
    now,
  });

  const item = {
    loadId,
    companyId: client.companyId,
    createdAt: stamps.created,
    updatedAt: now,
    createdBy: "seed-tracking-scenario",
    loadType: "OTR",
    loadStatus: "in-transit",
    customer,
    broker: client.companyName || "Titan Freight",
    dispatcher: dispatcherName,
    equipmentType: "53ft Reefer",
    pickupFacility: PICKUP.facility,
    pickupAddress: PICKUP.address,
    pickupCity: PICKUP.city,
    pickupState: PICKUP.state,
    pickupZip: PICKUP.zip,
    pickupDate,
    pickupAppointmentTime: "06:00",
    pickupWindowStart: "05:30",
    pickupWindowEnd: "07:30",
    pickupInstructions: "Check in at the packing shed office. Reefer set to 34°F.",
    deliveryFacility: DELIVERY.facility,
    deliveryAddress: DELIVERY.address,
    deliveryCity: DELIVERY.city,
    deliveryState: DELIVERY.state,
    deliveryZip: DELIVERY.zip,
    deliveryDate,
    deliveryAppointmentTime: "19:00",
    deliveryWindowStart: "17:00",
    deliveryWindowEnd: "21:00",
    deliveryInstructions: "LA Wholesale Produce Market, Gate 3. Call receiving 30 min out.",
    commodityDescription: "Mixed produce — lettuce, berries, packed vegetables",
    weight: "48000",
    weightUnit: "lbs",
    temperatureRequirement: "34F",
    customerRate: String(billed),
    carrierRate: "3100",
    taxManualAmount: usTax.toFixed(2),
    taxCurrency: "USD",
    taxManualSource: "estimator",
    taxManualNote: `US freight tax ${usPercent}% on billed $${billed}.`,
    taxLines: [
      {
        country: "US",
        label: "US freight tax",
        amount: usTax.toFixed(2),
        currency: "USD",
        source: "estimator",
        note: `${usPercent}% on the billed freight ($${billed}).`,
      },
    ],
    trackingRequired: true,
    trackingMethod: "driver-app",
    assignedDriver: driver.sub,
    driverWorkflowStatus: "en-route-delivery",
    driverStatusHistory: buildHistory(driver, [
      { status: "assigned", at: stamps.accepted },
      { status: "en-route-pickup", at: stamps.enRoutePickup },
      { status: "at-pickup", at: stamps.atPickup },
      { status: "loaded", at: stamps.loaded },
      { status: "en-route-delivery", at: stamps.inTransit },
    ]),
    driverGps: {
      lat: gps.lat,
      lng: gps.lng,
      accuracyM: 9,
      speedMph: 58,
      headingDeg: 155,
      lastPingAt: now,
      serverAt: now,
      sharedBy: driver.sub,
      sharedByName: driver.name,
    },
    trackingSession: session,
  };

  await ddb.send(new PutCommand({ TableName: loadsTable, Item: item }));
  return { loadId, item, usTax, billed };
}

async function main() {
  if (!devVars.TITAN_AWS_ACCESS_KEY_ID) {
    console.error("Missing TITAN_AWS_ACCESS_KEY_ID in .dev.vars");
    process.exit(1);
  }

  const args = parseArgs(process.argv);
  const { clients, drivers } = await findActors();

  if (clients.length === 0) {
    console.error("No Client users found. Create one in Admin with the Customer Portal template.");
    process.exit(1);
  }
  if (drivers.length === 0) {
    console.error(
      "No Driver users found. Create a Driver in Admin, assign them to this company as employer, then re-run.",
    );
    process.exit(1);
  }

  const client =
    clients.find((c) => c.companyId && c.assignedCustomers.length > 0) ??
    clients.find((c) => c.companyId) ??
    clients[0];

  if (!client.companyId) {
    console.error("That client has no companyId. Assign the company, then re-run.");
    process.exit(1);
  }

  await ensureClientCustomers(client);

  const driver =
    drivers.find((d) => d.employerCompanyId && d.employerCompanyId === client.companyId) ??
    drivers[0];

  console.log("Client account");
  console.log(`  email     ${client.email}`);
  console.log(`  company   ${client.companyName ?? "(none)"} ${client.companyId}`);
  console.log(`  customers ${client.assignedCustomers.join(", ")}`);
  console.log("Driver (assigned on this load)");
  console.log(`  email     ${driver.email}`);
  console.log(`  name      ${driver.name}`);
  console.log(`  sub       ${driver.sub}`);
  if (driver.employerCompanyId && driver.employerCompanyId !== client.companyId) {
    console.log(
      "  note      driver employer does not match the client company — assignment still works (drivers are tenant-exempt).",
    );
  }

  if (args.refreshGps) {
    const existing = await latestScenarioLoad(client.companyId, args.loadId);
    if (!existing) {
      console.error(
        args.loadId
          ? `No load ${args.loadId}.`
          : `No ${LOAD_PREFIX}* load for this company. Run without --refresh-gps first.`,
      );
      process.exit(1);
    }
    await refreshGps(existing);
    printWhereToLook(existing.loadId, client, driver);
    return;
  }

  const dispatcherName = client.companyName ? `${client.companyName} Dispatch` : "Dispatcher";
  const { loadId, billed, usTax } = await createScenario({ client, driver, dispatcherName });

  console.log("\nCreated in-transit load");
  console.log(`  loadId    ${loadId}`);
  console.log(`  lane      ${PICKUP.city}, ${PICKUP.state} → ${DELIVERY.city}, ${DELIVERY.state}`);
  console.log("  story     assigned → accepted → picked up → rolling US-101 near Santa Maria");
  console.log(`  customer  ${client.assignedCustomers[0]}`);
  console.log(`  billed    $${billed.toFixed(2)}`);
  console.log(`  tax       $${usTax.toFixed(2)} USD`);
  console.log("  workflow  en-route-delivery / loadStatus in-transit");
  console.log("  gps       driver ping @ Santa Maria, CA (source=driver)");
  printWhereToLook(loadId, client, driver);
}

main().catch((err) => {
  console.error(err?.name ? `${err.name}: ${err.message}` : err);
  process.exit(1);
});
