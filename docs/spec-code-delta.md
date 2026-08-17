# Spec ↔ code delta

Assessed against commit `356eb50` plus the uncommitted work on `tenant-api-hardening`.

## Read this first: the spec is not in the repository

`docs/` contains only `security/` and the documents produced during this engagement.
There is no MVP document with §1–§21. I can verify every **code** claim below directly;
the **spec** column is quoted from the build prompt and is unverified at source.

That has three consequences worth deciding before the next stop:

1. The eight rows in the prompt's §0.3 are reproduced and confirmed. I cannot complete the
   table beyond them, because "complete" means "every place the spec and code disagree",
   and I can only see one side.
2. Section references (§4, §10, §18, §20 …) cannot be checked. Where a row below says the
   spec requires something, that is the prompt's claim, not something I read.
3. Where the prompt says "update the spec, don't change the code", I cannot make that
   edit.

**Ask:** put the MVP document in the repo, or point me at it. Until then this file is
partial by construction and should not be treated as the completed §0.3 deliverable.

---

## The eight rows, verified on the code side

| # | Spec (per the brief) | Code — verified | Consequence |
|---|---|---|---|
| 1 | `Load.customer_id` | `LoadRecord.customer?: string` — a free string ([loads-store.ts:21](../src/lib/loads-store.ts#L21)). `CrmAccounts` is a real table with `accountId` keys and 2 live records, but **nothing references it from a load** | No referential integrity between CRM and Loads. C3 is built to prove this and will. See "What C3 will actually find" below |
| 2 | IDs are UUIDv4 | Invoices use `INV-<loadId>`, deterministic ([accounting-store.ts:`createInvoiceId`](../src/lib/accounting-store.ts)). Loads use caller-supplied ids; CRM uses `ACC-nnnn` | Agreed: deterministic is the better choice, because it makes retry idempotent and lets the partition key enforce one-invoice-per-load. **Spec should change.** The customer-facing `invoiceNumber` — gapless, allocated at send — is a separate field and does not exist yet |
| 3 | `Tender` entity with recipients, tier, responses | `tendered` is one of fourteen `loadStatus` strings ([load-status.ts](../src/lib/load-status.ts)). No tender record, no recipients, no tier, no timeout, no response log | No waterfall, no atomic award, no e-signature. **§10's acceptance criteria are untestable, not merely unimplemented** — including C4's "auto-award blocked" and the "concurrent accepts ×20" SLA |
| 4 | Idempotency keys standard | Absent. Nothing in `src/lib` reads an `Idempotency-Key` header | Every "exactly once" assertion depends on them. Partially mitigated: invoice creation is idempotent *by construction* via the deterministic id + `attribute_not_exists`, and returns `409 already_exists`. Load creation has the same `attribute_not_exists` guard. So "exactly one invoice" is testable; "exactly one of anything else" is not |
| 5 | Audit logs everywhere; quote conversion writes an audit trail | **Loads have one** — `loadAuditTrail`, server-built, append-only, refuses client-supplied entries, before/after on economic fields ([load-audit.ts](../src/lib/load-audit.ts)). **Invoices have none.** `/quotes` and `/admin` call `recordAdminAuditLog`, a separate admin-only trail | Half the system is unauditable, and the two halves use different mechanisms. CX-9 provenance holds for loads and fails for invoices |
| 6 | No `Driver` entity | The driver portal exists and mutates load state through `/api/driver/loads`. The actor is a Cognito sub in `assignedDriver`; there is no driver record | The actor on most status transitions is not in the data model. Mitigated for the trail: server-written `driverStatusHistory` entries carry `by` = token sub, `serverAt`, and `source` |
| 7 | No `Payment` entity | Confirmed absent. `paidAt` is declared on `InvoiceRecord` and **no code anywhere writes it** | Cash application, short pays and DSO have no subject. Every invoice ages forever, so the DSO tile is not meaningful |
| 8 | `Invoice.factoring_ref` | `InvoiceRecord` has `factoringSubmissionId`, `factoringStatus`, `factoringAdvance` — **our receivable being factored**. The `Carrier` record has **no** factoring status, factor name, NOA or remit-to | The name collision is a trap: the field that exists is the opposite side of the transaction from the one §13 needs. The rule that matters — never pay a factored carrier directly — has no data to enforce it |

---

## Rows to add, found while verifying the eight

| # | Area | Code | Consequence |
|---|---|---|---|
| 9 | Status vocabularies | **Four**, with no authority between them: `loadStatus` (15 canonical values + aliases), `driverWorkflowStatus` (driver portal's `ActiveLoadStatus`), `TrackingState` (11 values), `InvoiceQueue` (5). A fifth — the customer-facing wording in §1.2 — does not exist | `docs/status-mapping.md` (stop 2) has to reconcile four, not two. Two are now kept in step at the write boundary by `loadStatusForDriverWorkflow`; `TrackingState` is derived; `InvoiceQueue` is independent |
| 10 | Invoice authorization | `/api/invoices` runs through the generic resource proxy, which **never reads `ctx.role`**. Demonstrated live: a sent invoice's total rewritten $3,265.50 → $1.00 and then deleted, nothing refusing, nothing recording ([accounting-findings.md §0.2](accounting-findings.md)) | CX-8 role projection fails at the API for every invoice field, for every role. C10's sweep will find this on its first row |
| 11 | Fabricated data | `buildPayablesFromLoads` derived payables from the array index — now removed and replaced with an explicit empty state | Was the §2.5 "exclude the fabricated" case. No longer needs excluding; nothing else in accounting fabricates |
| 12 | Money representation | Float dollars throughout; rounding applied per-line **and** to the subtotal | C1's "rate survives every hop unchanged" is asserting equality on floats that have been rounded twice. Assert in integer cents or the chain will produce false passes and false failures |
| 13 | Tracking simulator | The Tracking board synthesises GPS progress on a 15s ticker and fires geofence arrivals from it, persisting `loadStatus` to DynamoDB — see [surface-entity-matrix.md](surface-entity-matrix.md) | **Blocks C6 and CX-1.** A dwell event may be simulated, so an accessorial traced back to it traces to nothing real. The probe cannot open Tracking without perturbing what it measures |

---

## What C3 will actually find

C3 is designed to fail on `load.customer` being a free string. Precisely how:

1. **Creating** an account in `/crm` writes a `CrmAccounts` row with an `accountId`.
2. **Using** it on a load stores `load.customer` as the account's *name*, copied by value.
   There is no `customerId`, and the create-load form has no account picker bound to CRM —
   the field is free text.
3. **`/accounting`** derives its customer from `load.customer` — `draftFromLoad` sets
   `customer: load.customer?.trim() || "Customer"`. The invoice stores the name by value a
   second time.
4. **Renaming** in CRM updates only the `CrmAccounts` row. The load keeps the old string,
   the invoice keeps its own copy of the old string, and `/analytics` groups by whatever
   string it finds.

So the assertion "every surface shows the new name and none stored it as a value" fails at
three independent points, and the failure is silent: nothing errors, the surfaces simply
disagree. Two loads for the same customer typed differently — `Acme Foods` and
`ACME Foods` — are two customers to every aggregate in the system.

This is the strongest argument for the `customerId` migration already agreed: CRM is the
party master, `BillingProfile` hangs off `accountId`, and `load.customer` becomes a
foreign key with an exact-match backfill and a human review report for the rest.

---

## Q3 answered: the eleven-day invoice is real, and the cause is one level over

The hypothesis was `documents: string[]` versus `documentAssets[]`. That split is **not**
the bug — the driver writes both (`patchLoadRecord(id, { documentAssets, documents })`) and
`loadHasPod` checks both. Covered.

The bug is the **document kind**:

```
driver uploads type "Bill of Lading"  ->  kind "bol"  ->  documents ["bol:signed.jpg"]

loadHasPod(["pod:signed.jpg"])            -> true
loadHasPod(["bol:signed.jpg"])            -> false
loadHasPod(["bol:BOL-556731-signed.jpg"]) -> false
```

`loadHasPod` matches `startsWith("pod:")` or `/pod|proof/i`. A signed BOL matches neither.
So a driver who uploads the signed bill of lading at delivery — which in freight **is** the
proof of delivery — leaves the load failing the POD gate, `isLoadBillable` false, and the
invoice never enters the ready-to-bill queue. That is the operator's complaint exactly:
*"The driver uploads the signed BOL. Accounting says no POD on file and the invoice sits
eleven days."*

**It is not a one-line fix, and this is why I have not made it.** Accepting `bol` outright
would let a BOL uploaded at *pickup* satisfy the *delivery* gate — invoicing a load whose
only document proves it was loaded, not delivered. That is worse than the current failure,
because it bills without proof rather than failing to bill with it.

Three defensible resolutions, needing a decision:

1. **Accept `bol` only when uploaded at or after the `delivered` transition.** The
   timestamps now exist — `driverStatusHistory` carries a server-stamped `serverAt` per
   status, and each asset has an `uploadedAt`. Most faithful to how freight actually works.
2. **Add a distinct kind** — `signed-delivery-receipt` — and steer the driver's upload sheet
   to default to it once the load is at delivery. Cleanest model, needs a driver-app change.
3. **Accept any document uploaded after `delivered`,** whatever its kind. Simplest, loosest;
   a lumper receipt would satisfy the POD gate.

My recommendation is 1, with 2 as the follow-up so the driver is not relying on us to infer
intent from a timestamp.

---

## Q5 answered: `cancelled` is a pattern, not an instance

Applied as a lens, four more cases of a value handled by readers and produced by nothing —
tabulated in [surface-entity-matrix.md](surface-entity-matrix.md#dead-state-handling--values-readers-handle-that-nothing-can-produce).
`loadStatus.cancelled` and `.exception`; three of five `factoringStatus` values; two of
three `CarrierPayable.status` values; and `paidAt`.

The pattern is that **the data model was written ahead of the transitions**. That is
actively misleading rather than merely incomplete: a reviewer who sees `isLoadBillable`
exclude `cancelled` concludes cancellation is handled. It is not implemented at all.

---

## Where Part 1 conflicts with the code — flagged, not resolved

Per the closing instruction.

1. **"One load, one truth" vs four status vocabularies.** The rule says different words per
   audience are fine given a documented mapping. There is no mapping and no authority. Two
   of the four are now synchronised at the write boundary; `TrackingState` is derived from
   them, and `InvoiceQueue` is unrelated. **Question:** is `loadStatus` the canonical state,
   with the rest projections of it? If so, `TrackingState` should stop being independently
   mutable — today `applyDriverAction` can move it directly.
2. **"A number on a dashboard is a claim."** `/dashboard` and `/analytics` derive counts
   client-side from a cached load list, with no drill-through that re-queries the same
   predicate. Reconciliation is therefore comparing two client-side computations over one
   cached array — it will pass without proving anything. **Question:** does the tile
   requirement mean server-side aggregation, or is client-side derivation acceptable
   provided the drill-through uses the identical predicate?
3. **"Documents are one set."** `LoadRecord` has two: `documents: string[]` (filename
   strings) and `documentAssets: LoadDocumentAsset[]` (with `dataUrl`). Different code paths
   read different ones — `isLoadEligibleForTracking` requires `documentAssets`, while
   `loadHasPod` accepts either. CX-5 cannot assert "identical count" until these are one
   collection. **Question:** is `documents` legacy, and can it be migrated into
   `documentAssets`?
4. **"Every dollar has a traceable origin."** Detention is a hand-typed string on the load.
   `detentionClockStart` exists and is called by nothing. There is no link from an invoice
   line to a geofence event. **Question:** should detention be computed from the arrival /
   departure timestamps now recorded in `driverStatusHistory`, or entered by a human with
   the computed figure shown alongside?
5. **"Terminal is terminal everywhere."** `cancelled` is reachable in the transition table
   but is **not** in the create-load dropdown, so no UI produces it. C8 cancels "from
   `/loads` detail, from the board, and from `/truckboard`" — none of those three paths
   exists. **Question:** should cancel be built as part of this work, or does C8 become a
   finding rather than a chain?
