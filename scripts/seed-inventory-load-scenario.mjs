#!/usr/bin/env node
/**
 * QA scenario for Loads ↔ Inventory (McLeod-style reserve / ship / release).
 *
 * Writes a small warehouse and four loads whose ledger already matches, plus
 * one load that is *intentionally* out of sync so Save is the thing that
 * allocates. Re-run is idempotent: the same item, movement and load ids are
 * overwritten rather than duplicated.
 *
 *   node scripts/seed-inventory-load-scenario.mjs
 *   node scripts/seed-inventory-load-scenario.mjs --reset   # delete then recreate
 *
 * Then follow the "QA walkthrough" this script prints.
 */
import { readFileSync } from "node:fs";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from "@aws-sdk/client-cognito-identity-provider";

const SKU_PREFIX = "INV-QA-";
const LOAD_PREFIX = "L-INV-QA-";

const ITEM_IDS = {
  bev: "aaaaaaaa-aaaa-4aaa-8aaa-00000000be01",
  pallet: "aaaaaaaa-aaaa-4aaa-8aaa-00000000pl01",
  tight: "aaaaaaaa-aaaa-4aaa-8aaa-00000000tg01",
  reefer: "aaaaaaaa-aaaa-4aaa-8aaa-00000000rf01",
};

const LOAD_IDS = {
  booked: `${LOAD_PREFIX}BOOKED`,
  transit: `${LOAD_PREFIX}TRANSIT`,
  cancel: `${LOAD_PREFIX}CANCEL`,
  unsync: `${LOAD_PREFIX}UNSYNC`,
};

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

function isoMinutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

const devVars = parseEnvFile(".dev.vars");
const appEnv = parseEnvFile(".env");
const region = devVars.TITAN_AWS_REGION || appEnv.VITE_AWS_REGION || "us-west-1";
const userPoolId = appEnv.VITE_COGNITO_USER_POOL_ID;
const profileTable = appEnv.VITE_PROFILE_TABLE_NAME || "UsersTable";
const loadsTable = appEnv.VITE_LOADS_TABLE_NAME || "Loads";
const itemsTable = appEnv.VITE_INVENTORY_ITEMS_TABLE_NAME || "InventoryItems";
const movementsTable = appEnv.VITE_INVENTORY_MOVEMENTS_TABLE_NAME || "InventoryMovements";

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

async function findCompanyActor() {
  const cognitoUsers = await listAllUsers();
  const writers = [];
  for (const user of cognitoUsers) {
    const sub = attr(user.Attributes, "sub");
    const email = attr(user.Attributes, "email") ?? user.Username;
    if (!sub) continue;
    const profile = await ddb.send(
      new GetCommand({ TableName: profileTable, Key: { userId: sub, section: "permissions" } }),
    );
    const permissions = profile.Item?.data ?? {};
    const companyId = permissions.companyId ?? attr(user.Attributes, "custom:companyId");
    if (!companyId) continue;
    const role = String(permissions.role ?? "");
    writers.push({
      sub,
      email,
      role,
      companyId,
      companyName: permissions.companyName ?? null,
      name: email.split("@")[0],
    });
  }

  const preferred = new Set([
    "organization owner",
    "admin",
    "superadmin",
    "operations manager",
    "dispatcher",
    "broker",
  ]);
  return (
    writers.find((row) => preferred.has(row.role.toLowerCase())) ??
    writers[0] ??
    null
  );
}

async function queryCompany(table, extra = {}) {
  const out = await ddb.send(
    new QueryCommand({
      TableName: table,
      IndexName: "companyId-index",
      KeyConditionExpression: "companyId = :cid",
      ExpressionAttributeValues: extra.ExpressionAttributeValues
        ? { ":cid": extra.companyId, ...extra.ExpressionAttributeValues }
        : { ":cid": extra.companyId },
      ...Object.fromEntries(Object.entries(extra).filter(([key]) => key !== "companyId")),
    }),
  );
  return out.Items ?? [];
}

async function resetCompany(companyId) {
  const [items, movements, loads] = await Promise.all([
    queryCompany(itemsTable, { companyId }),
    queryCompany(movementsTable, { companyId }),
    queryCompany(loadsTable, { companyId }),
  ]);

  const itemIds = new Set(Object.values(ITEM_IDS));
  const dropItems = items.filter(
    (row) => itemIds.has(row.itemId) || String(row.sku ?? "").startsWith(SKU_PREFIX),
  );
  const dropLoads = loads.filter((row) => String(row.loadId ?? "").startsWith(LOAD_PREFIX));
  const loadIds = new Set(dropLoads.map((row) => row.loadId));
  const dropMovements = movements.filter(
    (row) =>
      itemIds.has(row.itemId) ||
      String(row.sku ?? "").startsWith(SKU_PREFIX) ||
      loadIds.has(row.reference) ||
      String(row.movementId ?? "").startsWith("mv-inv-qa-"),
  );

  for (const row of dropMovements) {
    await ddb.send(new DeleteCommand({ TableName: movementsTable, Key: { movementId: row.movementId } }));
  }
  for (const row of dropItems) {
    await ddb.send(new DeleteCommand({ TableName: itemsTable, Key: { itemId: row.itemId } }));
  }
  for (const row of dropLoads) {
    await ddb.send(new DeleteCommand({ TableName: loadsTable, Key: { loadId: row.loadId } }));
  }

  console.log(
    `Reset  ${dropItems.length} SKUs, ${dropMovements.length} movements, ${dropLoads.length} loads`,
  );
}

function itemRecord({ companyId, createdBy, now, id, sku, name, extra, onHand, allocated }) {
  return {
    itemId: id,
    companyId,
    createdBy,
    createdAt: isoMinutesAgo(400),
    updatedAt: now,
    sku,
    name,
    category: extra.category,
    warehouse: extra.warehouse,
    binLocation: extra.bin,
    unitOfMeasure: extra.uom,
    quantityOnHand: onHand,
    quantityAllocated: allocated,
    reorderPoint: extra.reorderPoint,
    reorderQuantity: extra.reorderQty,
    unitCost: extra.cost,
    unitPrice: extra.price,
    supplierName: extra.supplier,
    hazmat: Boolean(extra.hazmat),
    temperatureControlled: Boolean(extra.reefer),
    temperatureRange: extra.temp,
    weightPerUnitLb: extra.weight,
    status: "Active",
    lastMovementAt: now,
    notes: extra.notes,
  };
}

function movement({
  id,
  item,
  kind,
  quantity,
  onHandDelta,
  allocatedDelta,
  resultingOnHand,
  resultingAllocated,
  reference,
  reason,
  createdAt,
  companyId,
  createdBy,
  now,
}) {
  return {
    movementId: id,
    companyId,
    createdBy,
    createdAt,
    updatedAt: now,
    itemId: item.itemId,
    sku: item.sku,
    itemName: item.name,
    kind,
    quantity,
    onHandDelta,
    allocatedDelta,
    resultingOnHand,
    resultingAllocated,
    warehouse: item.warehouse,
    reason,
    reference,
    postedState: "posted",
    actorRole: "Operations Manager",
  };
}

function line({ item, qty, lineId }) {
  return {
    lineId,
    itemId: item.itemId,
    sku: item.sku,
    itemName: item.name,
    warehouse: item.warehouse,
    unitOfMeasure: item.unitOfMeasure,
    quantity: qty,
    weightPerUnitLb: item.weightPerUnitLb,
  };
}

function loadRecord({
  loadId,
  status,
  companyId,
  createdBy,
  dispatcher,
  customer,
  now,
  createdAt,
  pickupDate,
  deliveryDate,
  lines,
  commodity,
  notes,
}) {
  const pieces = lines.reduce((sum, row) => sum + row.quantity, 0);
  const weight = Math.round(
    lines.reduce((sum, row) => sum + row.quantity * (row.weightPerUnitLb ?? 0), 0),
  );
  return {
    loadId,
    companyId,
    createdBy,
    createdAt,
    updatedAt: now,
    loadType: "OTR",
    loadStatus: status,
    customer,
    broker: "Titan Freight",
    dispatcher,
    equipmentType: "dry-van",
    loadPriority: "standard",
    pickupFacility: "Riverside DC",
    pickupAddress: "11800 Harrel Street",
    pickupCity: "Mira Loma",
    pickupState: "CA",
    pickupZip: "91752",
    pickupDate,
    pickupAppointmentTime: "08:00",
    pickupWindowStart: "07:00",
    pickupWindowEnd: "10:00",
    pickupInstructions: "Warehouse dock 4. Inventory is reserved against this load.",
    deliveryFacility: "Phoenix Crossdock",
    deliveryAddress: "401 South 7th Street",
    deliveryCity: "Phoenix",
    deliveryState: "AZ",
    deliveryZip: "85034",
    deliveryDate,
    deliveryAppointmentTime: "16:00",
    deliveryWindowStart: "14:00",
    deliveryWindowEnd: "18:00",
    commodityDescription: commodity,
    weight: String(weight || 1000),
    weightUnit: "lbs",
    pieceCount: String(pieces),
    palletCount: String(Math.max(1, Math.round(pieces / 8))),
    customerRate: "2800",
    carrierRate: "2100",
    inventoryLines: lines,
    internalNotes: notes,
    trackingRequired: true,
    trackingMethod: "driver-app",
  };
}

function printWalkthrough({ actor, items, loads }) {
  const bev = items.bev;
  const tight = items.tight;
  console.log("\n════════════════════════════════════════════════════════════");
  console.log("QA walkthrough — Loads ↔ Inventory");
  console.log("════════════════════════════════════════════════════════════");
  console.log(`Login as   ${actor.email}  (${actor.role})`);
  console.log("Hard-refresh once (Ctrl+Shift+R) so the list cache is not stale.\n");

  console.log("1. Happy path — reserved stock");
  console.log(`   Inventory  http://localhost:8080/inventory`);
  console.log(`     ${bev.sku}  on hand 60, allocated 24, available 36`);
  console.log("     (100 received, 40 already shipped on TRANSIT, 24 still reserved on BOOKED)");
  console.log("     Hover Allocated → should show load ids, clickable.");
  console.log("     Ledger tab → reference badges should open the load.");
  console.log(`   Load       http://localhost:8080/loads/${loads.booked}`);
  console.log("     Freight step lists 24 × INV-QA-BEV-24 and 4 × INV-QA-TIGHT.");
  console.log("     Save without changes → no new ledger rows (already in sync).\n");

  console.log("2. The live allocate — this load has lines but no reservation yet");
  console.log(`   http://localhost:8080/loads/${loads.unsync}`);
  console.log("     Open, Save. Inventory should allocate 10 × INV-QA-BEV-24.");
  console.log("     If Save succeeds but Allocated does not move, that is a sync bug.");
  console.log("     After this, BEV allocated should be 34 (24 booked + 10 unsync), available 26.\n");

  console.log("3. Insufficient stock");
  console.log(`     ${tight.sku} has 5 on hand, 4 already reserved → 1 available.`);
  console.log("     Create load (or edit BOOKED) and set TIGHT qty to 8.");
  console.log("     Expected: warning toast, load may still save, allocated stays 4.");
  console.log("     Bug if: on-hand goes negative, or UI promised 8 and API refused.\n");

  console.log("4. Shipped freight cannot shrink");
  console.log(`   http://localhost:8080/loads/${loads.transit}`);
  console.log("     Status is in-transit. Ledger already shipped 40 BEV + 20 REEFER.");
  console.log("     Drop BEV qty to 5 and Save.");
  console.log("     Expected: 'cannot drop below … already shipped' warning.");
  console.log("     Bug if: on-hand increases (auto-unship) or the line silently reverts.\n");

  console.log("5. Cancel / release");
  console.log(`   http://localhost:8080/loads/${loads.cancel}`);
  console.log("     Already cancelled + released. INV-QA-PALLET should show 0 allocated.");
  console.log("     Re-open BOOKED, change status to Cancelled, Save.");
  console.log("     Expected: the 24 BEV + 4 TIGHT reservations return to Available.");
  console.log("     Bug if: cancelled load still holds allocation.\n");

  console.log("6. Pickup ships the reservation");
  console.log(`   On ${loads.booked} (if still booked): set status to In Transit, Save.`);
  console.log("     Expected: allocated drops, on-hand drops by the line qty.");
  console.log("     Bug if: on-hand drops twice, or allocated goes negative.\n");

  console.log("7. Cache / navigation");
  console.log("     After any Save, open Inventory without a full reload.");
  console.log("     Numbers should match the ledger. Stale cache is a product bug.\n");

  console.log("Expected warehouse *before* you click Save on UNSYNC:");
  console.log("  SKU              on hand  alloc  avail");
  console.log("  INV-QA-BEV-24        60     24     36");
  console.log("  INV-QA-PALLET        40      0     40");
  console.log("  INV-QA-TIGHT          5      4      1");
  console.log("  INV-QA-REEFER        30      0     30  (20 already shipped on TRANSIT)");
}

async function main() {
  if (!devVars.TITAN_AWS_ACCESS_KEY_ID) {
    console.error("Missing TITAN_AWS_ACCESS_KEY_ID in .dev.vars");
    process.exit(1);
  }
  if (!userPoolId) {
    console.error("Missing VITE_COGNITO_USER_POOL_ID in .env");
    process.exit(1);
  }

  const reset = process.argv.includes("--reset");
  const actor = await findCompanyActor();
  if (!actor) {
    console.error("No Cognito user with a companyId. Assign a company in Admin, then re-run.");
    process.exit(1);
  }

  console.log("Company");
  console.log(`  id        ${actor.companyId}`);
  console.log(`  name      ${actor.companyName ?? "(unset)"}`);
  console.log(`  actor     ${actor.email}  (${actor.role || "no role"})`);

  if (reset) await resetCompany(actor.companyId);

  const now = new Date().toISOString();
  const createdBy = "seed-inventory-load-scenario";
  const customer = actor.companyName || "Oakwell Farms";

  const bev = itemRecord({
    companyId: actor.companyId,
    createdBy,
    now,
    id: ITEM_IDS.bev,
    sku: `${SKU_PREFIX}BEV-24`,
    name: "Cased non-alcoholic beverages",
    onHand: 100,
    allocated: 24,
    extra: {
      category: "Food & Beverage",
      warehouse: "Riverside DC",
      bin: "A-12-04",
      uom: "Case",
      reorderPoint: 20,
      reorderQty: 80,
      cost: 8.4,
      price: 12.5,
      supplier: "Pacific Bottling",
      weight: 40,
      notes: "QA seed. 100 received, 40 shipped on TRANSIT, 24 reserved on BOOKED.",
    },
  });

  const pallet = itemRecord({
    companyId: actor.companyId,
    createdBy,
    now,
    id: ITEM_IDS.pallet,
    sku: `${SKU_PREFIX}PALLET`,
    name: "Empty CHEP pallets",
    onHand: 40,
    allocated: 0,
    extra: {
      category: "Packaging & Supplies",
      warehouse: "Riverside DC",
      bin: "YARD-2",
      uom: "Pallet",
      reorderPoint: 10,
      reorderQty: 40,
      cost: 12,
      price: 18,
      supplier: "CHEP",
      weight: 50,
      notes: "QA seed. 12 were reserved on CANCEL and then released.",
    },
  });

  const tight = itemRecord({
    companyId: actor.companyId,
    createdBy,
    now,
    id: ITEM_IDS.tight,
    sku: `${SKU_PREFIX}TIGHT`,
    name: "Limited hazmat drums (oversell trap)",
    onHand: 5,
    allocated: 4,
    extra: {
      category: "Hazmat",
      warehouse: "Riverside DC",
      bin: "HAZ-01",
      uom: "Drum",
      reorderPoint: 4,
      reorderQty: 8,
      cost: 95,
      price: 140,
      supplier: "WestChem",
      hazmat: true,
      weight: 420,
      notes: "QA seed. Only 1 available — use this to force allocation_exceeds_stock.",
    },
  });

  const reefer = itemRecord({
    companyId: actor.companyId,
    createdBy,
    now,
    id: ITEM_IDS.reefer,
    sku: `${SKU_PREFIX}REEFER`,
    name: "Chilled mixed produce totes",
    onHand: 30,
    allocated: 0,
    extra: {
      category: "Refrigerated",
      warehouse: "Riverside DC",
      bin: "COOL-3",
      uom: "Tote",
      reorderPoint: 8,
      reorderQty: 24,
      cost: 22,
      price: 31,
      supplier: "Oakwell Farms",
      reefer: true,
      temp: "34F",
      weight: 38,
      notes: "QA seed. 50 received, 20 shipped on TRANSIT.",
    },
  });

  const catalog = { bev, pallet, tight, reefer };

  const movements = [
    movement({
      id: "mv-inv-qa-bev-open",
      item: bev,
      kind: "receipt",
      quantity: 100,
      onHandDelta: 100,
      allocatedDelta: 0,
      resultingOnHand: 100,
      resultingAllocated: 0,
      reason: "Opening balance",
      createdAt: isoMinutesAgo(390),
      companyId: actor.companyId,
      createdBy,
      now,
    }),
    movement({
      id: "mv-inv-qa-plt-open",
      item: pallet,
      kind: "receipt",
      quantity: 40,
      onHandDelta: 40,
      allocatedDelta: 0,
      resultingOnHand: 40,
      resultingAllocated: 0,
      reason: "Opening balance",
      createdAt: isoMinutesAgo(389),
      companyId: actor.companyId,
      createdBy,
      now,
    }),
    movement({
      id: "mv-inv-qa-tgt-open",
      item: tight,
      kind: "receipt",
      quantity: 5,
      onHandDelta: 5,
      allocatedDelta: 0,
      resultingOnHand: 5,
      resultingAllocated: 0,
      reason: "Opening balance",
      createdAt: isoMinutesAgo(388),
      companyId: actor.companyId,
      createdBy,
      now,
    }),
    movement({
      id: "mv-inv-qa-rfr-open",
      item: reefer,
      kind: "receipt",
      quantity: 50,
      onHandDelta: 50,
      allocatedDelta: 0,
      resultingOnHand: 50,
      resultingAllocated: 0,
      reason: "Opening balance",
      createdAt: isoMinutesAgo(387),
      companyId: actor.companyId,
      createdBy,
      now,
    }),
    movement({
      id: "mv-inv-qa-bev-book",
      item: bev,
      kind: "allocate",
      quantity: 24,
      onHandDelta: 0,
      allocatedDelta: 24,
      resultingOnHand: 100,
      resultingAllocated: 24,
      reference: LOAD_IDS.booked,
      reason: `Reserved for load ${LOAD_IDS.booked}`,
      createdAt: isoMinutesAgo(120),
      companyId: actor.companyId,
      createdBy,
      now,
    }),
    movement({
      id: "mv-inv-qa-tgt-book",
      item: tight,
      kind: "allocate",
      quantity: 4,
      onHandDelta: 0,
      allocatedDelta: 4,
      resultingOnHand: 5,
      resultingAllocated: 4,
      reference: LOAD_IDS.booked,
      reason: `Reserved for load ${LOAD_IDS.booked}`,
      createdAt: isoMinutesAgo(119),
      companyId: actor.companyId,
      createdBy,
      now,
    }),
    movement({
      id: "mv-inv-qa-bev-ship-a",
      item: bev,
      kind: "allocate",
      quantity: 40,
      onHandDelta: 0,
      allocatedDelta: 40,
      resultingOnHand: 100,
      resultingAllocated: 64,
      reference: LOAD_IDS.transit,
      reason: `Reserved for load ${LOAD_IDS.transit}`,
      createdAt: isoMinutesAgo(200),
      companyId: actor.companyId,
      createdBy,
      now,
    }),
    movement({
      id: "mv-inv-qa-bev-ship-b",
      item: bev,
      kind: "shipment",
      quantity: 40,
      onHandDelta: -40,
      allocatedDelta: -40,
      resultingOnHand: 60,
      resultingAllocated: 24,
      reference: LOAD_IDS.transit,
      reason: `Shipped on load ${LOAD_IDS.transit}`,
      createdAt: isoMinutesAgo(90),
      companyId: actor.companyId,
      createdBy,
      now,
    }),
    movement({
      id: "mv-inv-qa-rfr-ship-a",
      item: reefer,
      kind: "allocate",
      quantity: 20,
      onHandDelta: 0,
      allocatedDelta: 20,
      resultingOnHand: 50,
      resultingAllocated: 20,
      reference: LOAD_IDS.transit,
      reason: `Reserved for load ${LOAD_IDS.transit}`,
      createdAt: isoMinutesAgo(199),
      companyId: actor.companyId,
      createdBy,
      now,
    }),
    movement({
      id: "mv-inv-qa-rfr-ship-b",
      item: reefer,
      kind: "shipment",
      quantity: 20,
      onHandDelta: -20,
      allocatedDelta: -20,
      resultingOnHand: 30,
      resultingAllocated: 0,
      reference: LOAD_IDS.transit,
      reason: `Shipped on load ${LOAD_IDS.transit}`,
      createdAt: isoMinutesAgo(89),
      companyId: actor.companyId,
      createdBy,
      now,
    }),
    movement({
      id: "mv-inv-qa-plt-hold",
      item: pallet,
      kind: "allocate",
      quantity: 12,
      onHandDelta: 0,
      allocatedDelta: 12,
      resultingOnHand: 40,
      resultingAllocated: 12,
      reference: LOAD_IDS.cancel,
      reason: `Reserved for load ${LOAD_IDS.cancel}`,
      createdAt: isoMinutesAgo(80),
      companyId: actor.companyId,
      createdBy,
      now,
    }),
    movement({
      id: "mv-inv-qa-plt-rel",
      item: pallet,
      kind: "release",
      quantity: 12,
      onHandDelta: 0,
      allocatedDelta: -12,
      resultingOnHand: 40,
      resultingAllocated: 0,
      reference: LOAD_IDS.cancel,
      reason: `Released from load ${LOAD_IDS.cancel}`,
      createdAt: isoMinutesAgo(40),
      companyId: actor.companyId,
      createdBy,
      now,
    }),
  ];

  // Ledger-derived levels after the full history (not the intermediate snapshots
  // on each row). BEV: 100 in, 40 shipped, 24 still reserved.
  bev.quantityOnHand = 60;
  bev.quantityAllocated = 24;
  pallet.quantityOnHand = 40;
  pallet.quantityAllocated = 0;
  tight.quantityOnHand = 5;
  tight.quantityAllocated = 4;
  reefer.quantityOnHand = 30;
  reefer.quantityAllocated = 0;

  const bookedLines = [
    line({ item: bev, qty: 24, lineId: "il-book-bev" }),
    line({ item: tight, qty: 4, lineId: "il-book-tgt" }),
  ];
  const transitLines = [
    line({ item: bev, qty: 40, lineId: "il-tr-bev" }),
    line({ item: reefer, qty: 20, lineId: "il-tr-rfr" }),
  ];
  const cancelLines = [line({ item: pallet, qty: 12, lineId: "il-cx-plt" })];
  const unsyncLines = [line({ item: bev, qty: 10, lineId: "il-un-bev" })];

  const loads = {
    booked: loadRecord({
      loadId: LOAD_IDS.booked,
      status: "booked",
      companyId: actor.companyId,
      createdBy,
      dispatcher: actor.name,
      customer,
      now,
      createdAt: isoMinutesAgo(125),
      pickupDate: isoMinutesAgo(-24 * 60).slice(0, 10),
      deliveryDate: isoMinutesAgo(-48 * 60).slice(0, 10),
      lines: bookedLines,
      commodity: "24 × INV-QA-BEV-24 Cased non-alcoholic beverages; 4 × INV-QA-TIGHT Limited hazmat drums",
      notes: "QA: already reserved. Save with no edits should post nothing.",
    }),
    transit: loadRecord({
      loadId: LOAD_IDS.transit,
      status: "in-transit",
      companyId: actor.companyId,
      createdBy,
      dispatcher: actor.name,
      customer,
      now,
      createdAt: isoMinutesAgo(210),
      pickupDate: isoMinutesAgo(20).slice(0, 10),
      deliveryDate: isoMinutesAgo(-12 * 60).slice(0, 10),
      lines: transitLines,
      commodity: "40 × INV-QA-BEV-24; 20 × INV-QA-REEFER Chilled mixed produce totes",
      notes: "QA: already shipped. Lowering qty below 40/20 should warn, not unship.",
    }),
    cancel: loadRecord({
      loadId: LOAD_IDS.cancel,
      status: "cancelled",
      companyId: actor.companyId,
      createdBy,
      dispatcher: actor.name,
      customer,
      now,
      createdAt: isoMinutesAgo(85),
      pickupDate: isoMinutesAgo(-72 * 60).slice(0, 10),
      deliveryDate: isoMinutesAgo(-96 * 60).slice(0, 10),
      lines: cancelLines,
      commodity: "12 × INV-QA-PALLET Empty CHEP pallets",
      notes: "QA: cancelled. Reservation was released. PALLET allocated must be 0.",
    }),
    unsync: loadRecord({
      loadId: LOAD_IDS.unsync,
      status: "booked",
      companyId: actor.companyId,
      createdBy,
      dispatcher: actor.name,
      customer,
      now,
      createdAt: isoMinutesAgo(15),
      pickupDate: isoMinutesAgo(-36 * 60).slice(0, 10),
      deliveryDate: isoMinutesAgo(-60 * 60).slice(0, 10),
      lines: unsyncLines,
      commodity: "10 × INV-QA-BEV-24 Cased non-alcoholic beverages",
      notes: "QA: lines on the load, no allocate row yet. Save this load to fire the live path.",
    }),
  };

  for (const item of Object.values(catalog)) {
    await ddb.send(new PutCommand({ TableName: itemsTable, Item: item }));
  }
  for (const row of movements) {
    await ddb.send(new PutCommand({ TableName: movementsTable, Item: row }));
  }
  for (const item of Object.values(loads)) {
    await ddb.send(new PutCommand({ TableName: loadsTable, Item: item }));
  }

  console.log("\nWrote");
  console.log("  SKUs      INV-QA-BEV-24, INV-QA-PALLET, INV-QA-TIGHT, INV-QA-REEFER");
  console.log("  loads     " + Object.values(LOAD_IDS).join(", "));
  console.log("  ledger    12 movements (opening + allocate/ship/release)");

  printWalkthrough({
    actor,
    items: catalog,
    loads: LOAD_IDS,
  });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
