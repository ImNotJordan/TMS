import type { LoadRecord } from "./loads-store";
import { findAssetByKind } from "./load-documents";
import {
  ensureAppSettingsCache,
  getAppSettingBool,
  getAppSettingString,
} from "./app-settings-store";
import {
  getAwsRegion,
  getInvoicesTableName,
  isDynamoAccessDenied,
  isDynamoResourceNotFound,
  isInvoicesConfigured,
} from "./dynamodb";
import { createDynamoEntityStore } from "./dynamo-entity-store";

export type InvoiceQueue =
  | "ready-to-bill"
  | "sent"
  | "in-dispute"
  | "factored"
  | "sent-to-collections";

export const INVOICE_QUEUES: { id: InvoiceQueue; label: string; hint: string }[] = [
  { id: "ready-to-bill", label: "Ready to bill", hint: "POD on file · not invoiced" },
  { id: "sent", label: "Sent", hint: "Awaiting customer payment" },
  { id: "in-dispute", label: "In dispute", hint: "Customer / accessorial dispute" },
  { id: "factored", label: "Factored", hint: "Submitted to factor · advance pending" },
  { id: "sent-to-collections", label: "Sent to collections", hint: "Partner handoff" },
];

export type InvoiceLineKind = "linehaul" | "fuel" | "accessorial" | "tax" | "other";

export type InvoiceLineItem = {
  id: string;
  kind: InvoiceLineKind;
  label: string;
  amount: number;
};

export type InvoiceRecord = {
  invoiceId: string;
  loadId: string;
  customer: string;
  carrier?: string;
  lane: string;
  status: InvoiceQueue;
  lines: InvoiceLineItem[];
  subtotal: number;
  tax: number;
  total: number;
  remitTo: string;
  terms: string;
  issuedAt?: string;
  dueAt?: string;
  paidAt?: string;
  factoringSubmissionId?: string;
  factoringStatus?: "draft" | "submitted" | "advanced" | "settled" | "rejected";
  factoringAdvance?: number;
  disputeReason?: string;
  collectionsPartner?: string;
  collectionsEscalationAt?: string;
  podOnFile: boolean;
  rateConRef?: string;
  createdAt: string;
  updatedAt: string;
};

export type CarrierPayable = {
  id: string;
  loadId: string;
  carrier: string;
  amount: number;
  quickPay: boolean;
  quickPayFeePct: number;
  status: "open" | "scheduled" | "paid";
  dueAt: string;
  taxYear: number;
  ytdPaid: number;
};

export type CollectionsRule = {
  id: string;
  name: string;
  daysPastDue: number;
  action: string;
  channel: "email" | "sms" | "call" | "partner";
};

export type AccountingSnapshot = {
  invoices: InvoiceRecord[];
  payables: CarrierPayable[];
  collectionsRules: CollectionsRule[];
  dsoDays: number;
  arOpen: number;
  overdue: number;
  factoredAdvance: number;
  readyToBillCount: number;
};

const LEGACY_STORAGE_KEY = "titan.accounting.invoices.v1";
const MIGRATION_FLAG_KEY = "titan.accounting.invoices.migrated.v1";

function mapInvoiceError(err: unknown, op: string): Error {
  if (err instanceof Error) {
    if (isDynamoResourceNotFound(err)) {
      const table = getInvoicesTableName();
      const awsRegion = getAwsRegion() ?? "your AWS region";
      return new Error(
        `DynamoDB table "${table}" was not found in ${awsRegion}. ` +
          `Create it with partition key "invoiceId" (String), then set VITE_INVOICES_TABLE_NAME=${table} in .env.`,
      );
    }
    if (isDynamoAccessDenied(err)) {
      return new Error(
        `Access denied for DynamoDB table "${getInvoicesTableName()}". ` +
          `Add dynamodb:Scan, GetItem, PutItem, and DeleteItem to the authenticated Identity Pool role.`,
      );
    }
  }
  return err instanceof Error ? err : new Error(`DynamoDB ${op} failed`);
}

const invoiceStore = createDynamoEntityStore<InvoiceRecord>({
  tableName: getInvoicesTableName,
  idKey: "invoiceId",
  label: "Invoices",
  kind: "invoices",
  createIfNotExists: false,
  updateIfExists: false,
});

function parseMoney(value?: string): number {
  if (!value) return 0;
  const n = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function moneyRound(n: number) {
  return Math.round(n * 100) / 100;
}

function canUseStorage() {
  try {
    return typeof localStorage !== "undefined";
  } catch {
    return false;
  }
}

function readLegacyLocalInvoices(): InvoiceRecord[] {
  if (!canUseStorage()) return [];
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as InvoiceRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function clearLegacyLocalInvoices() {
  if (!canUseStorage()) return;
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    localStorage.setItem(MIGRATION_FLAG_KEY, "1");
  } catch {
    /* ignore */
  }
}

function legacyAlreadyMigrated() {
  if (!canUseStorage()) return true;
  try {
    return localStorage.getItem(MIGRATION_FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

export async function listAllInvoices(): Promise<InvoiceRecord[]> {
  if (!isInvoicesConfigured()) {
    throw new Error(
      "Invoices table is not configured. Set VITE_INVOICES_TABLE_NAME and VITE_COGNITO_IDENTITY_POOL_ID in .env.",
    );
  }
  try {
    return await invoiceStore.listAll();
  } catch (err) {
    throw mapInvoiceError(err, "Scan");
  }
}

export async function listAllInvoicesCached(options?: {
  force?: boolean;
  scope?: string;
}): Promise<InvoiceRecord[]> {
  if (!isInvoicesConfigured()) {
    throw new Error(
      "Invoices table is not configured. Set VITE_INVOICES_TABLE_NAME and VITE_COGNITO_IDENTITY_POOL_ID in .env.",
    );
  }
  try {
    return await invoiceStore.listAllCached(options);
  } catch (err) {
    throw mapInvoiceError(err, "Scan");
  }
}

export async function getInvoiceById(invoiceId: string): Promise<InvoiceRecord | null> {
  try {
    return await invoiceStore.getById(invoiceId);
  } catch (err) {
    throw mapInvoiceError(err, "GetItem");
  }
}

export async function putInvoice(invoice: InvoiceRecord): Promise<InvoiceRecord> {
  try {
    return await invoiceStore.put({
      ...invoice,
      invoiceId: invoice.invoiceId.trim(),
    });
  } catch (err) {
    throw mapInvoiceError(err, "PutItem");
  }
}

export async function deleteInvoice(invoiceId: string): Promise<void> {
  try {
    await invoiceStore.remove(invoiceId);
  } catch (err) {
    throw mapInvoiceError(err, "DeleteItem");
  }
}

export function loadHasPod(load: LoadRecord): boolean {
  if (findAssetByKind(load.documentAssets, "pod")?.dataUrl) return true;
  return (load.documents ?? []).some((d) => d.startsWith("pod:") || /pod|proof/i.test(d));
}

export function isLoadBillable(
  load: LoadRecord,
  opts?: { requirePod?: boolean },
): boolean {
  const status = (load.loadStatus ?? "").toLowerCase();
  if (["cancelled", "canceled", "draft", "booked"].includes(status)) return false;
  const requirePod = opts?.requirePod ?? getAppSettingBool("require_pod_before_invoice", true);
  if (requirePod && !loadHasPod(load)) return false;
  return (
    status === "delivered" ||
    status === "completed" ||
    status === "pod-uploaded" ||
    (load.driverWorkflowStatus ?? "").toLowerCase() === "delivered"
  );
}

export function laneForLoad(load: LoadRecord): string {
  const a = [load.pickupCity, load.pickupState].filter(Boolean).join(", ");
  const b = [load.deliveryCity, load.deliveryState].filter(Boolean).join(", ");
  if (a && b) return `${a} → ${b}`;
  return load.loadId;
}

export function buildDraftLinesFromLoad(load: LoadRecord): InvoiceLineItem[] {
  const linehaul =
    parseMoney(load.customerRate) ||
    parseMoney(load.linehaulRate) ||
    parseMoney(load.carrierRate);
  const fuel = parseMoney(load.fuelSurcharge);
  const accessorials = parseMoney(load.accessorialCharges);
  const detention = parseMoney(load.detentionRate);
  const lumper = parseMoney(load.lumperFee);
  const tonu = parseMoney(load.tonuFee);
  const layover = parseMoney(load.layoverFee);

  const lines: InvoiceLineItem[] = [
    {
      id: "linehaul",
      kind: "linehaul",
      label: "Linehaul / rate confirmation",
      amount: moneyRound(linehaul),
    },
  ];
  if (fuel > 0) {
    lines.push({ id: "fuel", kind: "fuel", label: "Fuel surcharge", amount: moneyRound(fuel) });
  }
  if (accessorials > 0) {
    lines.push({
      id: "accessorials",
      kind: "accessorial",
      label: "Accessorials",
      amount: moneyRound(accessorials),
    });
  }
  if (detention > 0) {
    lines.push({
      id: "detention",
      kind: "accessorial",
      label: "Detention",
      amount: moneyRound(detention),
    });
  }
  if (lumper > 0) {
    lines.push({ id: "lumper", kind: "accessorial", label: "Lumper", amount: moneyRound(lumper) });
  }
  if (tonu > 0) {
    lines.push({ id: "tonu", kind: "accessorial", label: "TONU", amount: moneyRound(tonu) });
  }
  if (layover > 0) {
    lines.push({ id: "layover", kind: "accessorial", label: "Layover", amount: moneyRound(layover) });
  }

  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const tax = moneyRound(subtotal * 0);
  if (tax > 0) {
    lines.push({ id: "tax", kind: "tax", label: "Tax", amount: tax });
  }
  return lines;
}

export function totalsFromLines(lines: InvoiceLineItem[]) {
  const subtotal = moneyRound(
    lines.filter((l) => l.kind !== "tax").reduce((s, l) => s + l.amount, 0),
  );
  const tax = moneyRound(lines.filter((l) => l.kind === "tax").reduce((s, l) => s + l.amount, 0));
  return { subtotal, tax, total: moneyRound(subtotal + tax) };
}

function createInvoiceId(loadId: string) {
  const prefix = getAppSettingString("invoice_number_prefix", "INV-");
  const stamp = Date.now().toString(36).toUpperCase().slice(-5);
  const cleanPrefix = prefix.endsWith("-") ? prefix : `${prefix}-`;
  return `${cleanPrefix}${loadId}-${stamp}`;
}

function dueDateFromTerms(issuedAt: string, terms?: string): string {
  const daysMatch = (terms ?? "Net 30").match(/(\d+)/);
  const days = daysMatch ? Number(daysMatch[1]) : 30;
  const d = new Date(issuedAt);
  d.setDate(d.getDate() + (Number.isFinite(days) ? days : 30));
  return d.toISOString();
}

function draftFromLoad(load: LoadRecord): InvoiceRecord {
  const lines = buildDraftLinesFromLoad(load);
  const { subtotal, tax, total } = totalsFromLines(lines);
  const now = new Date().toISOString();
  return {
    invoiceId: createInvoiceId(load.loadId),
    loadId: load.loadId,
    customer: load.customer?.trim() || "Customer",
    carrier: load.assignedCarrier,
    lane: laneForLoad(load),
    status: "ready-to-bill",
    lines,
    subtotal,
    tax,
    total,
    remitTo: "Titan Freight LLC · ACH · ****4821",
    terms: load.paymentTerms?.trim() || "Net 30",
      podOnFile: loadHasPod(load),
    rateConRef: `RC-${load.loadId}`,
    createdAt: now,
    updatedAt: now,
  };
}

/** One-shot migrate browser-local invoices into Dynamo, then clear localStorage. */
async function migrateLegacyLocalInvoices(existing: InvoiceRecord[]): Promise<InvoiceRecord[]> {
  if (legacyAlreadyMigrated()) return existing;
  const legacy = readLegacyLocalInvoices();
  if (legacy.length === 0) {
    clearLegacyLocalInvoices();
    return existing;
  }
  const byId = new Map(existing.map((i) => [i.invoiceId, i]));
  const merged = [...existing];
  for (const inv of legacy) {
    if (!inv?.invoiceId || byId.has(inv.invoiceId)) continue;
    try {
      const saved = await putInvoice(inv);
      merged.push(saved);
      byId.set(saved.invoiceId, saved);
    } catch (err) {
      console.warn("[Accounting] legacy invoice migrate failed", inv.invoiceId, err);
    }
  }
  clearLegacyLocalInvoices();
  return merged;
}

function buildPayablesFromLoads(loads: LoadRecord[]): CarrierPayable[] {
  const year = new Date().getFullYear();
  return loads
    .filter((l) => {
      const status = (l.loadStatus ?? "").toLowerCase();
      return (
        Boolean(l.assignedCarrier?.trim()) &&
        (status === "delivered" || status === "completed" || status === "pod-uploaded")
      );
    })
    .slice(0, 40)
    .map((l, idx) => {
      const amount = parseMoney(l.carrierRate) || parseMoney(l.linehaulRate);
      const due = new Date();
      due.setDate(due.getDate() + (idx % 2 === 0 ? 7 : 21));
      return {
        id: `ap-${l.loadId}`,
        loadId: l.loadId,
        carrier: l.assignedCarrier!.trim(),
        amount: moneyRound(amount),
        quickPay: idx % 3 === 0,
        quickPayFeePct: 2.5,
        status: idx % 5 === 0 ? "paid" : "open",
        dueAt: due.toISOString(),
        taxYear: year,
        ytdPaid: moneyRound(amount * (1 + (idx % 4))),
      } satisfies CarrierPayable;
    });
}

/** Simplified DSO: AR / (trailing sales per day). */
export function computeDsoDays(invoices: InvoiceRecord[], now = Date.now()): number {
  const open = invoices.filter((i) =>
    ["sent", "in-dispute", "factored", "sent-to-collections"].includes(i.status),
  );
  const ar = open.reduce((s, i) => s + i.total, 0);
  const windowStart = now - 30 * 24 * 60 * 60 * 1000;
  const sales = invoices
    .filter((i) => i.issuedAt && Date.parse(i.issuedAt) >= windowStart)
    .reduce((s, i) => s + i.total, 0);
  const salesPerDay = sales / 30;
  if (salesPerDay <= 0) {
    if (ar <= 0) return 0;
    return Math.round(
      open.reduce((s, i) => {
        const issued = i.issuedAt ? Date.parse(i.issuedAt) : now;
        return s + Math.max(0, (now - issued) / (24 * 60 * 60 * 1000));
      }, 0) / Math.max(1, open.length),
    );
  }
  return Math.round(ar / salesPerDay);
}

function snapshotFromInvoices(invoices: InvoiceRecord[], loads: LoadRecord[]): AccountingSnapshot {
  const dsoDays = computeDsoDays(invoices);
  const arOpen = invoices
    .filter((i) => ["sent", "in-dispute", "factored"].includes(i.status))
    .reduce((s, i) => s + i.total, 0);
  const overdue = invoices
    .filter((i) => i.status === "sent" && i.dueAt && Date.parse(i.dueAt) < Date.now())
    .reduce((s, i) => s + i.total, 0);
  const factoredAdvance = invoices
    .filter((i) => i.status === "factored")
    .reduce((s, i) => s + (i.factoringAdvance ?? 0), 0);

  return {
    invoices: [...invoices].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")),
    payables: buildPayablesFromLoads(loads),
    collectionsRules: DEFAULT_COLLECTIONS_RULES,
    dsoDays,
    arOpen,
    overdue,
    factoredAdvance,
    readyToBillCount: invoices.filter((i) => i.status === "ready-to-bill").length,
  };
}

/**
 * Merge Dynamo invoices with live billable loads (POD required).
 * Creates and persists ready-to-bill drafts for billable loads missing an invoice.
 */
export async function buildAccountingSnapshot(loads: LoadRecord[]): Promise<AccountingSnapshot> {
  await ensureAppSettingsCache();
  const requirePod = getAppSettingBool("require_pod_before_invoice", true);

  let persisted = await listAllInvoices();
  persisted = await migrateLegacyLocalInvoices(persisted);

  const byLoad = new Map(persisted.map((inv) => [inv.loadId, inv]));
  const billable = loads.filter((load) => isLoadBillable(load, { requirePod }));
  const invoices: InvoiceRecord[] = [...persisted];

  for (const load of billable) {
    if (byLoad.has(load.loadId)) continue;
    const draft = draftFromLoad(load);
    try {
      const saved = await putInvoice(draft);
      invoices.push(saved);
      byLoad.set(saved.loadId, saved);
    } catch (err) {
      // Still show draft in UI if Put fails mid-session (table missing, etc.)
      console.warn("[Accounting] draft put failed", load.loadId, err);
      invoices.push(draft);
      byLoad.set(draft.loadId, draft);
    }
  }

  const billableIds = new Set(billable.map((l) => l.loadId));
  const pruned: InvoiceRecord[] = [];
  for (const inv of invoices) {
    if (inv.status !== "ready-to-bill") {
      pruned.push(inv);
      continue;
    }
    if (billableIds.has(inv.loadId)) {
      pruned.push(inv);
      continue;
    }
    // Stale ready-to-bill draft — remove from Dynamo when possible
    try {
      await deleteInvoice(inv.invoiceId);
    } catch {
      /* keep in memory filtered out */
    }
  }

  return snapshotFromInvoices(pruned, loads);
}

export async function upsertInvoice(invoice: InvoiceRecord): Promise<InvoiceRecord> {
  return putInvoice(invoice);
}

export async function generateInvoiceFromReady(
  invoice: InvoiceRecord,
  edits?: Partial<Pick<InvoiceRecord, "lines" | "remitTo" | "terms" | "tax">>,
): Promise<InvoiceRecord> {
  if (!invoice.podOnFile && getAppSettingBool("require_pod_before_invoice", true)) {
    throw new Error("Invoice can only be generated when POD is on file.");
  }
  const lines = edits?.lines ?? invoice.lines;
  const { subtotal, tax, total } = totalsFromLines(
    edits?.tax != null
      ? [
          ...lines.filter((l) => l.kind !== "tax"),
          { id: "tax", kind: "tax", label: "Tax", amount: edits.tax },
        ]
      : lines,
  );
  const issuedAt = new Date().toISOString();
  const terms = edits?.terms ?? invoice.terms;
  const next: InvoiceRecord = {
    ...invoice,
    lines,
    subtotal,
    tax,
    total,
    remitTo: edits?.remitTo ?? invoice.remitTo,
    terms,
    status: "sent",
    issuedAt,
    dueAt: dueDateFromTerms(issuedAt, terms),
    updatedAt: issuedAt,
  };
  return upsertInvoice(next);
}

export async function submitInvoiceToFactoring(invoice: InvoiceRecord): Promise<InvoiceRecord> {
  if (invoice.status === "ready-to-bill") {
    throw new Error("Generate and send the invoice before factoring.");
  }
  const submissionId = `FAC-${Date.now().toString(36).toUpperCase()}`;
  const next: InvoiceRecord = {
    ...invoice,
    status: "factored",
    factoringSubmissionId: submissionId,
    factoringStatus: "submitted",
    factoringAdvance: moneyRound(invoice.total * 0.9),
    updatedAt: new Date().toISOString(),
  };
  return upsertInvoice(next);
}

export async function markInvoiceDisputed(
  invoice: InvoiceRecord,
  reason: string,
): Promise<InvoiceRecord> {
  return upsertInvoice({
    ...invoice,
    status: "in-dispute",
    disputeReason: reason.trim() || "Customer dispute",
    updatedAt: new Date().toISOString(),
  });
}

export async function handoffToCollections(
  invoice: InvoiceRecord,
  partner = "Apex Collections",
): Promise<InvoiceRecord> {
  return upsertInvoice({
    ...invoice,
    status: "sent-to-collections",
    collectionsPartner: partner,
    collectionsEscalationAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

export async function reconcileFactoringAdvance(invoice: InvoiceRecord): Promise<InvoiceRecord> {
  if (!invoice.factoringSubmissionId) {
    throw new Error("Missing factoring submission id.");
  }
  return upsertInvoice({
    ...invoice,
    factoringStatus: "advanced",
    updatedAt: new Date().toISOString(),
  });
}

export const DEFAULT_COLLECTIONS_RULES: CollectionsRule[] = [
  {
    id: "r1",
    name: "Friendly reminder",
    daysPastDue: 3,
    action: "Send payment reminder with invoice PDF",
    channel: "email",
  },
  {
    id: "r2",
    name: "Finance escalation",
    daysPastDue: 15,
    action: "Notify AP contact + broker owner",
    channel: "email",
  },
  {
    id: "r3",
    name: "Dispute capture",
    daysPastDue: 25,
    action: "Open dispute workspace; freeze factoring",
    channel: "call",
  },
  {
    id: "r4",
    name: "Collections handoff",
    daysPastDue: 45,
    action: "Auto handoff to collections partner with packet",
    channel: "partner",
  },
];

export function money(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

export function moneyExact(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value || 0);
}
