# Accounting module — findings against the Controller's brief

**Assessed against commit `356eb50`** ("Move admin, profile, and Cognito mutations behind
server proxies and strip browser IAM grants") **plus the uncommitted work on branch
`tenant-api-hardening`.** The Controller's brief was written against an earlier state;
§0.1 lists what it names that is already closed. Re-read §0.1 before re-opening any item
in §1.1 of the brief.

Mapping every item in Part 1.2 and 1.3 to what exists today in
[`accounting-store.ts`](../src/lib/accounting-store.ts), [`accounting.tsx`](../src/routes/accounting.tsx)
and the API tier. No code written yet, per the brief.

Three states: **present** (works, may need hardening), **partial** (a field exists but
nothing enforces or computes it), **absent** (no subject in the codebase).

---

## 0. Two corrections to the brief before anything else

### 0.1 Four of the five defects in §1.1 are already closed

The brief was written against the code as it stood before this branch. Current state,
with evidence — worth confirming before spending effort re-fixing them:

| Ref | Brief says | Actual state |
|---|---|---|
| **B5** | `linehaul = customerRate \|\| linehaulRate \|\| carrierRate` | **Fixed.** `carrierRate` is gone from the chain ([accounting-store.ts:398](../src/lib/accounting-store.ts#L398)). A missing customer rate now yields linehaul `0` *and* a blocking `missing_customer_rate` problem from `describeLoadBillingProblems`, and `generateInvoiceFromReady` refuses to send when linehaul ≤ 0. Covered by [invoice-money.test.ts](../src/lib/invoice-money.test.ts) |
| **B11** | No one-invoice-per-load constraint | **Fixed.** `createInvoiceId` is deterministic `INV-<loadId>`, so the partition key enforces uniqueness. Revisions are explicit (`-R2`) |
| **B4** | Id collision, `PutCommand` with no condition | **Fixed.** `attribute_not_exists(idKey)` on create, and a duplicate now returns `409 already_exists` rather than the opaque 502 it returned until yesterday |
| **B3 / B2** | Rates writable post-delivery; no transition control | **Fixed for loads.** `LOAD_POST_DELIVERY_FROZEN_FIELDS` + `isLoadDelivered` (reads *both* status fields), and a server-side transition table returning 409 `illegal_transition` |
| **B7** | Float dollars, double rounding, 0-decimal display | **Open.** Unchanged. This is the real remaining item from §1.1 |
| **G32** | No audit row | **Fixed for loads only — see 0.2** |

The fix order in §1.1 should therefore be re-read as: **B7 and the invoice-side
authorization gap**, which is not in the brief's table at all.

### 0.2 The gap the brief does not name is the most urgent one

Load endpoints got role gates and an audit trail. **The invoice endpoints got neither.**

`/api/invoices` is served by the generic
[`resource-proxy.ts`](../src/lib/api/resource-proxy.ts), which resolves a tenant context
and **never reads `ctx.role`** — grep for it returns nothing. So today, any authenticated
member of the tenant — Sales, Marketing, a driver with a company account — can:

- create an invoice
- edit a **sent** invoice's lines and total, straight through `PATCH /api/invoices/:id`,
  bypassing every guard in `accounting-store` because those guards live in browser code
- **delete** any invoice outright, `DELETE /api/invoices/:id` → 204

That last one matters most. `isInvoiceLocked`, `updateInvoiceDraft` and `reviseInvoice`
are all client-side functions. They are the correct rules, and they are advice: the API
underneath enforces none of them. §1.3.3 (immutability after posting) and §1.3.5 (no
deletes) are both violated by a single `curl`.

**Verified against the running server and the real Invoices table**, not inferred from
reading the code — signed in as a real Cognito user, one probe, three requests:

```
create a SENT invoice for $3,265.50                              201
rewrite a SENT invoice's total to $1.00 and empty its lines      200
   -> {"total":1,"lines":[],"status":"sent"}
is the mutation recorded anywhere?                               no audit fields on the record
delete the financial record outright                             204
   re-read                                                       404
```

A sent invoice's total went from $3,265.50 to $1.00 with its line items removed, and then
the record ceased to exist. Nothing refused any step and nothing recorded any of it.

**Recommendation: this precedes B7.** A money migration on records that anyone can
silently delete or rewrite is rearranging furniture. It is also the smaller job — the
pattern from `tenant/load-permissions.ts` and `load-audit.ts` transfers directly.

### 0.3 The payables screen shows fabricated numbers

`buildPayablesFromLoads` ([accounting-store.ts:576](../src/lib/accounting-store.ts#L576))
does not read payable data. It derives it from the array index:

```js
quickPay:   idx % 3 === 0,
status:     idx % 5 === 0 ? "paid" : "open",
dueAt:      today + (idx % 2 === 0 ? 7 : 21) days,
ytdPaid:    amount * (1 + (idx % 4)),
```

Every carrier payable on that screen — whether it is paid, when it is due, whether it is
quick-pay, and the YTD figure that would feed a 1099 — is a placeholder rendered in the
same typography as real money. It also `.slice(0, 40)`, silently truncating.

This is worse than absent. Absent is a blank screen; this is a screen a controller can
read and act on. It should be removed or labelled as sample data **today**, ahead of any
other work here, regardless of what gets built after.

---

## 1. Receivables (§1.2)

| Requirement | State | What exists / what is missing |
|---|---|---|
| **Invoice packet** — per-customer required documents, refuse to send without them | **absent** | `podOnFile: boolean` is the entire document model. `loadHasPod` sniffs for a filename containing `pod`/`proof`. No `Customer` entity, so no per-customer requirements list; no lumper receipt, scale ticket, or accessorial approval as document types; no packet completeness anywhere |
| **Billing deadlines** — void-if-not-invoiced-in-N-days, alert and report | **absent** | No `billingDeadlineDays`, no days-since-delivery on the queue, no alert. The Ready-to-Bill queue is unsorted by risk. A load can sit past a 30-day contractual window with nothing surfacing it |
| **Accessorial completeness** — every recorded accessorial billed, waived with approver, or blocking | **partial** | Seven accessorial types carry from the load: detention, lumper, TONU, layover, plus a lump `accessorialCharges` ([:335](../src/lib/accounting-store.ts#L335)). Each is a free-text `string` on `LoadRecord`. **No accessorial codes**, no driver-assist / redelivery / storage / reconsignment / stop-off / tarping / hazmat / overweight-permit, no waiver, no approver, no completeness check. Detention is a hand-typed number — nothing computes it, though `detentionClockStart` now exists and is unused |
| **Short pays and deductions** | **absent** | No `Payment` entity at all. An invoice cannot be partially paid. `in-dispute` exists as a status with a free-text `disputeReason`; there are no reason codes and no open-balance tracking |
| **Cash application** — remittance import, apply across invoices, unapplied cash, overpayment | **absent** | Nothing. And note there is no *payment* concept whatsoever: `paidAt` is declared on `InvoiceRecord` and **no code anywhere writes it** (verified). There is no way to mark an invoice paid by any means |
| **Aging** — current/1-30/31-60/61-90/90+, by customer, DSO | **partial** | `computeDsoDays` exists ([:423](../src/lib/accounting-store.ts#L423)) and `arOpen` / `overdue` totals are computed. No buckets, no per-customer breakdown. Because nothing can be marked paid, **every invoice ages forever** — the DSO figure climbs without bound and is not currently meaningful |
| **Credit control** — limit, exposure, hold blocking new tenders | **absent** | No `creditLimit`, no exposure calculation, no hold, and no hook from accounting into the tender path |

---

## 2. Payables and settlement (§1.2)

| Requirement | State | What exists / what is missing |
|---|---|---|
| **Factoring / NOA** — carrier factoring status, factor name, NOA on file, remit-to; pay run must **refuse** to pay the carrier direct | **absent** | The `Carrier` record has no factoring fields at all. `factoringStatus` on `InvoiceRecord` is *our* receivable being factored — a different thing entirely, and the name collision is a trap. No NOA, no factor remit-to, no block. Per §1.2 this is the legally serious one |
| **Carrier compliance gates before payment** | **partial** | `insuranceExpiresAt`, `w9OnFile`, `w9ReceivedAt`, `authorityStatus` all exist on the carrier record, and `isInsuranceExpired` is implemented. But they gate **carrier award** only — nothing in any payment path consults them, because there is no payment path |
| **Deductions** — advances, fuel cards, escrow, claims, chargebacks | **absent** | No `Deduction` entity. `CarrierPayable.amount` is a single gross figure |
| **Quick pay** — discount, eligibility, effect on margin | **partial** | `quickPay: boolean` and `quickPayFeePct: 2.5` exist on `CarrierPayable` — both **fabricated from the index** (§0.3). Not modelled as a line, not applied to any total, no eligibility rule |
| **Payables aging and cash forecast** | **absent** | `dueAt` exists and is invented. No aging, no forecast |

---

## 3. Margin and close (§1.2)

| Requirement | State | What exists / what is missing |
|---|---|---|
| **Margin per load / lane / customer / carrier / rep** | **partial** | [analytics-events.ts:203](../src/lib/analytics-events.ts#L203) computes `margin = customer − carrier` and a percentage, per load, as a derived analytics event — which satisfies INV-6's "derived, never stored". But it is float arithmetic, it is on the analytics surface rather than accounting, and there is no lane / customer / carrier / rep rollup, no margin floor, no unbilled-accessorial flag. A `"Can View Gross Margin"` permission string exists in [admin-user-constants.ts:96](../src/lib/admin-user-constants.ts#L96) and is not enforced anywhere |
| **Accruals** — revenue at delivery, carrier cost at delivery | **absent** | No accrual concept. Revenue effectively "exists" when someone opens the Accounting page and a draft is auto-created (see §5) |
| **Period close** | **absent** | No `AccountingPeriod`, no close, no lock. Every write path is open in perpetuity |
| **GL export** — balanced journal entries, COA mapping, QuickBooks/NetSuite/Sage | **absent** | Nothing. No journal entity, no chart of accounts, no export |

---

## 4. Controls (§1.3)

| Control | State | Detail |
|---|---|---|
| **1. Segregation of duties** | **absent** | No capability model. Roles are ten display strings; `load-permissions.ts` gates loads by role set, which is the right shape but does not extend to accounting and has no concept of "a different actor than last time" |
| **2. Approval thresholds** | **absent** | No approval anywhere. Credit memos, write-offs and rate changes are unapproved and unbounded |
| **3. Immutability after posting** | **partial → effectively absent** | `isInvoiceLocked`, `updateInvoiceDraft` and `reviseInvoice` implement exactly the right rule — and all three are browser-side. The API accepts a `PATCH` to a sent invoice (§0.2). Immutability is currently a UI convention |
| **4. Complete audit trail on money fields** | **partial** | `loadAuditTrail` is live for loads: server-built, append-only, refuses client-supplied entries, records before/after for economic fields ([load-audit.ts](../src/lib/load-audit.ts)). **Invoices have no audit at all.** INV-9 fails for every invoice mutation |
| **5. No deletes** | **absent** | `deleteInvoice` exists and `DELETE /api/invoices/:id` works for any tenant member. No void, no reason, no approver |

---

## 5. Two structural issues not in the brief

**Drafts are created as a side effect of viewing a page.** `buildAccountingSnapshot`
persists a `ready-to-bill` invoice for every billable load that lacks one, on page load
([:665](../src/lib/accounting-store.ts#L665)), and *deletes* drafts whose load is no
longer billable. Opening a report writes and destroys financial records. Under a period
close this is untenable, and it means invoice creation has no actor — the audit row, when
it exists, would attribute it to whoever happened to open the tab.

**All accounting logic lives in the browser.** `accounting-store.ts` runs client-side and
reaches the database through the generic resource proxy. Every rule in it — the POD
requirement, the send lock, the linehaul-must-be-positive check — is advice to a client
that can be edited. The load domain already moved its rules server-side; accounting has
not. Any control from Part 1.3 built in `accounting-store.ts` will be unenforced by
construction.

---

## 6. Invariants (§2.2) — which are assertable today

| | Status |
|---|---|
| INV-1 `total === Σ lines` | **Holds.** `totalsFromLines` recomputes on every write; tested over 1,000 generated structures |
| INV-2 `total === rateCon + charges − credits` | **Not assertable.** No rate-confirmation record, no post-delivery charge entity. Credits exist as line kind only |
| INV-3 payments + credits + open === total | **Not assertable.** No payments |
| INV-4 one non-voided invoice per load | **Holds structurally** via the deterministic id, but "non-voided" has no meaning — there is no void |
| INV-5 netPay === gross − deductions | **Not assertable.** No deductions, no settlement |
| INV-6 margin derived | **Holds** in analytics; not present in accounting |
| INV-7 journal balances | **Not assertable.** No journals |
| INV-8 no write into a closed period | **Not assertable.** No periods |
| INV-9 audit row per money mutation | **Loads only.** Fails for invoices |
| INV-10 single currency per invoice | **Vacuously true.** No currency field exists; USD is hardcoded in `money()` / `moneyExact()` |

Two of ten are meaningfully assertable today.

---

## 7. Accounting-policy questions — I will not resolve these in code

Per the brief's closing instruction. Each changes what gets built.

1. **Revenue recognition point.** §1.2 says revenue is recognised at delivery. Today a
   record first exists when someone opens the Accounting page. Should delivery create the
   receivable (server-side, on the `delivered` transition), with invoicing as a later
   document event? That is the correct model and it is a larger change than the brief's
   sequencing implies.
2. **Who owns the customer master?** `Customer` doesn't exist — `load.customer` is a free
   string. Terms, credit limit, required documents and billing deadline all hang off it.
   Is there an existing CRM account record (`crm-accounts`) that should become the
   customer of record, or is this a new entity?
3. **Invoice numbering.** §2.3 wants sequential-per-tenant; the current id is deterministic
   from `loadId`, which is what makes retries idempotent. Sequential and
   derived-from-load conflict — a gapless sequence cannot be idempotent under retry
   without a reservation step. Which matters more: auditor-friendly gapless numbering, or
   idempotent creation? (My recommendation: sequence allocated by conditional write at
   *send* time, not draft time, so drafts stay idempotent and sent invoices stay gapless.)
4. **Void vs. delete for auto-created drafts.** §1.3.5 says no deletes on financial
   records. Auto-created `ready-to-bill` drafts are currently deleted routinely when a
   load stops being billable. Is a never-sent draft a financial record? (Recommendation:
   no — but then drafts must be clearly a different entity class from issued invoices,
   which argues for not persisting them at all until send.)
5. **Multi-currency.** Is any lane non-USD (Canada/Mexico cross-border)? INV-10 and the FX
   requirement are only meaningful if so, and it changes the `Money` type's blast radius.
6. **Quick-pay accounting.** Is the discount a reduction of carrier cost (increasing our
   margin) or fee income? It changes the margin calculation and the GL mapping.
7. **Segregation of duties at this headcount.** Enforcing "creator ≠ approver" requires at
   least two finance users per tenant. Small brokerages run one. Do we hard-block, or
   allow a documented single-user override that is itself audited?

---

## 8. Recommended sequence

Differs from the brief's only because of §0.1 and §0.2.

1. **Label or remove the fabricated payables screen.** Today. It is the only item here
   that actively misinforms.
2. **Invoice authorization + audit + no-delete**, server-side. The load pattern transfers
   directly. Without this, nothing downstream is enforceable, and §1.3.3 and §1.3.5 are
   violated right now.
3. **`money()` to two decimals.** One line, and it stops hiding drift from the humans who
   would catch it.
4. **The money migration (B7).** Integer minor units, single rounding boundary, lint rule,
   backfill with a drift detector. Everything else waits on this.
5. **Move accounting rules server-side.** The lock, the POD gate, the linehaul check.
6. Then the new surfaces, in the brief's order.

B5 is already done and needs no work. B11 and B4 are already done. B3 is done for loads
and needs the invoice-side equivalent, which is item 2.
