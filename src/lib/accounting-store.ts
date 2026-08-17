import { createApiBackedStore } from "./api/api-backed-store";
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

export type InvoiceLineKind = "linehaul" | "fuel" | "accessorial" | "tax" | "credit" | "other";

export type InvoiceLineItem = {
  id: string;
  kind: InvoiceLineKind;
  label: string;
  amount: number;
  /**
   * Where the number came from.
   *
   * `derived` was carried from the load; `manual` was typed by a person. Without
   * this, a hand-entered $400 accessorial and one that came off the rate
   * confirmation are indistinguishable on the invoice and in a dispute. Absent on
   * lines written before this field existed, which readers treat as `derived`.
   */
  source?: "derived" | "manual";
  /** For derived lines: the `LoadRecord` field this came from. */
  sourceField?: string;
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
  /** 1 for the original. Bumped by `reviseInvoice`; the original is never touched. */
  revision?: number;
  /** The `invoiceId` this revises, so the original stays reachable from the copy. */
  revisionOf?: string;
  revisionReason?: string;
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

const invoiceStore = createApiBackedStore<InvoiceRecord>({
  resource: "invoices",
  keys: { collection: "invoices", item: "invoice" },
  idKey: "invoiceId",
  kind: "invoices",
});

/**
 * Parse a money string, or fail.
 *
 * The previous version stripped every character outside `[0-9.-]` and coerced the
 * remainder, so `"$1.2.3"` became `NaN` and then **`0`** — a typo'd rate billed
 * as nothing, silently — and `"(500)"` became `+500`, an accounting negative with
 * its sign inverted.
 *
 * Returning `null` instead of `0` moves the decision to the caller, which is the
 * only place that knows whether a missing number is "no charge" or "do not send
 * this invoice".
 */
export function parseMoneyStrict(value?: string | number | null): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  let text = String(value).trim();
  if (!text) return null;

  // Accounting negatives: (500) means -500.
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1).trim();
  }

  // Currency symbols, thousands separators and surrounding whitespace only.
  text = text.replace(/[$\s,]/g, "");
  if (text.startsWith("-")) {
    negative = !negative;
    text = text.slice(1);
  }
  if (text.endsWith("-")) {
    // Trailing-minus form some AP exports use.
    negative = !negative;
    text = text.slice(0, -1);
  }

  // Exactly one unsigned decimal number, nothing else. `1.2.3` fails here rather
  // than silently becoming zero.
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(text)) return null;

  const n = Number(text);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/**
 * `parseMoneyStrict`, with an explicit fallback for callers where absence really
 * does mean zero. Never silently swallows a malformed value: `strict` returning
 * null for `"1.2.3"` and for `""` are different situations, and callers that care
 * use `parseMoneyStrict` directly.
 */
function parseMoney(value?: string): number {
  return parseMoneyStrict(value) ?? 0;
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

export function isLoadBillable(load: LoadRecord, opts?: { requirePod?: boolean }): boolean {
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

/**
 * The accessorials that carry from a load onto a draft invoice.
 *
 * Declared as data rather than seven copied `if` blocks so that adding a charge
 * type cannot forget the negative-value branch or the source attribution.
 */
const ACCESSORIAL_SOURCES: { id: string; field: keyof LoadRecord & string; label: string }[] = [
  { id: "detention", field: "detentionRate", label: "Detention" },
  { id: "lumper", field: "lumperFee", label: "Lumper" },
  { id: "tonu", field: "tonuFee", label: "TONU" },
  { id: "layover", field: "layoverFee", label: "Layover" },
  { id: "accessorials", field: "accessorialCharges", label: "Accessorials" },
];

export type LoadBillingProblem = {
  field: string;
  code: "missing_customer_rate" | "unparseable_amount";
  message: string;
};

/**
 * Why this load cannot be billed as it stands.
 *
 * Empty means the draft below is trustworthy. Non-empty must block sending — see
 * `generateInvoiceFromReady`, which refuses rather than rounding the problem away.
 */
export function describeLoadBillingProblems(load: LoadRecord): LoadBillingProblem[] {
  const problems: LoadBillingProblem[] = [];

  const customerFacing = [load.customerRate, load.linehaulRate].find(
    (v) => v != null && String(v).trim() !== "",
  );
  if (customerFacing == null) {
    problems.push({
      field: "customerRate",
      code: "missing_customer_rate",
      message:
        "This load has no customer rate. Set customerRate or linehaulRate before invoicing — " +
        "the carrier's rate is what we pay, not what we bill.",
    });
  } else if (parseMoneyStrict(customerFacing) == null) {
    problems.push({
      field: "customerRate",
      code: "unparseable_amount",
      message: `"${String(customerFacing)}" is not an amount.`,
    });
  }

  for (const field of ["fuelSurcharge", ...ACCESSORIAL_SOURCES.map((a) => a.field)] as const) {
    const raw = load[field as keyof LoadRecord] as string | undefined;
    if (raw == null || String(raw).trim() === "") continue;
    if (parseMoneyStrict(raw) == null) {
      problems.push({
        field,
        code: "unparseable_amount",
        message: `${field}: "${String(raw)}" is not an amount.`,
      });
    }
  }

  return problems;
}

/**
 * Draft invoice lines for a load.
 *
 * ## What changed and why
 *
 * The linehaul used to fall back `customerRate || linehaulRate || carrierRate`.
 * On a brokered load where dispatch had filled in the carrier's buy rate but not
 * the customer's sell rate, the customer was invoiced the buy rate — the entire
 * margin given away, on an invoice that looked completely normal. `carrierRate` is
 * gone from this function: it is what we pay, and it has no business on a customer
 * invoice. A load with no customer rate produces a zero linehaul *and* a problem
 * from `describeLoadBillingProblems`, which blocks the send.
 *
 * Every line also used to be gated `if (amount > 0)`, so a negative accessorial —
 * a credit — vanished from the invoice with no line and no warning. Negatives now
 * become explicit `credit` lines.
 */
export function buildDraftLinesFromLoad(load: LoadRecord): InvoiceLineItem[] {
  // Customer-facing rates only. `carrierRate` is deliberately absent.
  const linehaul = parseMoneyStrict(load.customerRate) ?? parseMoneyStrict(load.linehaulRate) ?? 0;
  const fuel = parseMoneyStrict(load.fuelSurcharge);

  const lines: InvoiceLineItem[] = [
    {
      id: "linehaul",
      kind: "linehaul",
      label: "Linehaul / rate confirmation",
      amount: moneyRound(linehaul),
      source: "derived",
      sourceField: load.customerRate ? "customerRate" : "linehaulRate",
    },
  ];

  const push = (
    id: string,
    label: string,
    amount: number,
    kind: InvoiceLineKind,
    field: string,
  ) => {
    if (amount === 0) return;
    lines.push({
      id: amount < 0 ? `${id}-credit` : id,
      kind: amount < 0 ? "credit" : kind,
      label: amount < 0 ? `${label} (credit)` : label,
      amount: moneyRound(amount),
      source: "derived",
      sourceField: field,
    });
  };

  if (fuel != null) push("fuel", "Fuel surcharge", fuel, "fuel", "fuelSurcharge");

  for (const { id, field, label } of ACCESSORIAL_SOURCES) {
    const amount = parseMoneyStrict(load[field] as string | undefined);
    if (amount != null) push(id, label, amount, "accessorial", field);
  }

  return lines;
}

export function totalsFromLines(lines: InvoiceLineItem[]) {
  // Credits carry a negative amount and belong in the subtotal, where they reduce
  // it. Only tax is separated out, because tax is computed on the subtotal.
  const subtotal = moneyRound(
    lines.filter((l) => l.kind !== "tax").reduce((s, l) => s + l.amount, 0),
  );
  const tax = moneyRound(lines.filter((l) => l.kind === "tax").reduce((s, l) => s + l.amount, 0));
  return { subtotal, tax, total: moneyRound(subtotal + tax) };
}

/**
 * The invoice id for a load, and its revisions.
 *
 * ## Why this is deterministic now
 *
 * It used to end in `Date.now().toString(36).slice(-5)`. That slice advances every
 * millisecond, which produced two distinct failures:
 *
 * - Two drafts in the *same* millisecond got the same id, and `put` tries an
 *   update before falling back to create — so the second draft silently
 *   overwrote the first invoice's lines and totals.
 * - Two drafts milliseconds apart got *different* ids, and nothing anywhere
 *   constrained one invoice per load. That is a shipper billed twice, and it took
 *   an ordinary double-click rather than a race.
 *
 * Deriving the id from the load makes one-invoice-per-load true by construction:
 * the partition key enforces it, so a duplicate draft collides with the existing
 * invoice instead of creating a second one. Corrections are explicit revisions.
 */
function createInvoiceId(loadId: string, revision = 1) {
  const prefix = getAppSettingString("invoice_number_prefix", "INV-");
  const cleanPrefix = prefix.endsWith("-") ? prefix : `${prefix}-`;
  const base = `${cleanPrefix}${loadId.trim()}`;
  return revision > 1 ? `${base}-R${revision}` : base;
}

/** Statuses after which an invoice is a sent document, not a draft. */
const LOCKED_INVOICE_STATUSES: ReadonlySet<InvoiceQueue> = new Set<InvoiceQueue>([
  "sent",
  "in-dispute",
  "factored",
  "sent-to-collections",
]);

export function isInvoiceLocked(invoice: Pick<InvoiceRecord, "status">): boolean {
  return LOCKED_INVOICE_STATUSES.has(invoice.status);
}

export class InvoiceLockedError extends Error {
  readonly code = "invoice_locked";
  constructor(status: InvoiceQueue) {
    super(
      `This invoice is ${status} and cannot be edited. Issue a credit memo or a revision ` +
        `so the original stays retrievable.`,
    );
    this.name = "InvoiceLockedError";
  }
}

export class LoadNotBillableError extends Error {
  readonly code = "load_not_billable";
  constructor(readonly problems: LoadBillingProblem[]) {
    super(problems.map((p) => p.message).join(" "));
    this.name = "LoadNotBillableError";
  }
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
    revision: 1,
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

/**
 * Carrier payables — deliberately empty until there is a settlement model.
 *
 * ## What this used to do
 *
 * It manufactured payables from the array index:
 *
 * ```
 * quickPay:   idx % 3 === 0
 * status:     idx % 5 === 0 ? "paid" : "open"
 * dueAt:      today + (idx % 2 === 0 ? 7 : 21) days
 * ytdPaid:    amount * (1 + (idx % 4))
 * ```
 *
 * Whether a carrier had been paid, when the payment was due, whether quick-pay
 * applied, and the year-to-date figure that would feed a 1099 — every one of them
 * was a placeholder, rendered in the same typography as real money, and silently
 * truncated to the first 40 loads.
 *
 * That is not an incomplete feature, it is a screen a controller can read and act
 * on that reports things which are not true. Absent is safer than plausible: an
 * empty panel prompts the question, a fabricated one answers it wrongly.
 *
 * The only real number in it was `carrierRate` off the load. That is a rate, not a
 * payable — a payable needs a settlement record, deductions, an approval and a
 * disbursement, none of which exist. Returning the rate alone under the heading
 * "payables" would imply an obligation the system has not created.
 *
 * Restore this when there is a `CarrierSettlement` entity to read from.
 */
function buildPayablesFromLoads(_loads: LoadRecord[]): CarrierPayable[] {
  return [];
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

/**
 * Save an edit to a draft invoice, refusing once it has been sent.
 *
 * `sent` used to be a status and nothing more — `upsertInvoice` accepted any
 * mutation at any status, so an invoice already in a shipper's AP queue could be
 * rewritten with no record that the numbers had changed. Corrections after
 * sending go through a credit memo or `reviseInvoice`, both of which leave the
 * original retrievable.
 */
export async function updateInvoiceDraft(
  invoice: InvoiceRecord,
  edits: Partial<Omit<InvoiceRecord, "invoiceId" | "loadId" | "createdAt">>,
): Promise<InvoiceRecord> {
  if (isInvoiceLocked(invoice)) throw new InvoiceLockedError(invoice.status);
  const merged = { ...invoice, ...edits };
  const { subtotal, tax, total } = totalsFromLines(merged.lines);
  return upsertInvoice({
    ...merged,
    subtotal,
    tax,
    total,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * A correction to a sent invoice, as a new record that points at the original.
 *
 * The original is never touched. That is the whole point: a shipper's AP system
 * has already seen it, and an invoice that changes after the fact is how a
 * reconciliation dispute becomes unwinnable.
 */
export async function reviseInvoice(
  original: InvoiceRecord,
  lines: InvoiceLineItem[],
  reason: string,
): Promise<InvoiceRecord> {
  const revision = (original.revision ?? 1) + 1;
  const { subtotal, tax, total } = totalsFromLines(lines);
  const now = new Date().toISOString();
  return upsertInvoice({
    ...original,
    invoiceId: createInvoiceId(original.loadId, revision),
    revision,
    revisionOf: original.invoiceId,
    revisionReason: reason.trim() || "Correction",
    status: "ready-to-bill",
    lines,
    subtotal,
    tax,
    total,
    issuedAt: undefined,
    dueAt: undefined,
    createdAt: now,
    updatedAt: now,
  });
}

export async function generateInvoiceFromReady(
  invoice: InvoiceRecord,
  edits?: Partial<Pick<InvoiceRecord, "lines" | "remitTo" | "terms" | "tax">>,
): Promise<InvoiceRecord> {
  if (isInvoiceLocked(invoice)) throw new InvoiceLockedError(invoice.status);
  if (!invoice.podOnFile && getAppSettingBool("require_pod_before_invoice", true)) {
    throw new Error("Invoice can only be generated when POD is on file.");
  }

  const lines = edits?.lines ?? invoice.lines;

  /**
   * Never send an invoice with no linehaul.
   *
   * A zero linehaul means the load had no customer rate — the case that used to
   * fall back to the carrier's buy rate and give the margin away. Now it produces
   * a zero, and a zero must stop here rather than reach a shipper's AP queue,
   * where it costs a customer relationship to unpick.
   */
  const linehaul = lines.filter((l) => l.kind === "linehaul").reduce((sum, l) => sum + l.amount, 0);
  if (linehaul <= 0) {
    throw new LoadNotBillableError([
      {
        field: "customerRate",
        code: "missing_customer_rate",
        message:
          "This invoice has no linehaul amount. Set the load's customer rate before sending — " +
          "an invoice for $0 linehaul will be rejected by the shipper and has to be reissued.",
      },
    ]);
  }
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

/**
 * Format an amount for display. Always two decimal places.
 *
 * This used to render `maximumFractionDigits: 0`, which meant every figure on the
 * accounting screens — AR open, overdue, factored advance, quote totals, RFP
 * buy/sell and margin — was shown rounded to the dollar. Combined with float
 * arithmetic and double rounding, that hid penny drift from the only people
 * positioned to catch it: an AR clerk looking at $1,847 could not see the cent a
 * customer's AP had just rejected the invoice over.
 *
 * There is no "summary" case that justifies dropping cents on a money figure. A
 * number too long for its space is a layout problem; a number missing its cents is
 * a reconciliation problem.
 *
 * Kept alongside `moneyExact` — which is now identical in output — because both
 * names are used across the app and collapsing them is a separate change. `money`
 * is not "approximate money" any more, and no new caller should assume it is.
 */
export function money(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value || 0);
}

export function moneyExact(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value || 0);
}
