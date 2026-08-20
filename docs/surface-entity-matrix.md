# Surface × entity matrix

Which of the sixteen routes reads and writes which entity, **derived from the code**
(imports cross-referenced against actual call sites), not from the spec.

Assessed against commit `356eb50` plus the uncommitted work on `tenant-api-hardening`.
Regenerate with `node sim.local/matrix.mjs`.

Several routes are thin wrappers — `/bidding`, `/risk`, `/communications` and `/admin`
delegate to a feature page, `/dashboard` to `routes/index.tsx` — so each row covers the
route file, its detail route, and the feature module that holds its logic.

---

## The matrix

`R` read · `W` write · `RW` both · `·` no access

| Route | Load | Invoice | Carrier | Truck | Quote | RFP | CRM | TrackSess | BidWksp | RiskModel | AdminUser | AdminAudit | Analytics |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `/dashboard` | R | · | R | · | R | R | · | · | R | · | · | · | · |
| `/loads` | **RW** | R | R | · | · | · | R | **RW** | · | · | · | · | · |
| `/truckboard` | · | · | · | **RW** | · | · | · | · | · | · | · | · | · |
| `/tracking` | R | · | · | · | · | · | · | **RW** | · | · | · | · | · |
| `/bidding` | **W** | · | · | · | · | · | · | · | **RW** | · | · | · | · |
| `/rfps` | · | · | · | · | **W** | **RW** | · | · | · | · | · | · | · |
| `/quotes` | **W** | · | · | · | **RW** | · | · | · | · | · | · | **RW** | · |
| `/carriers` | · | · | **RW** | · | · | · | · | · | · | · | · | · | · |
| `/crm` | · | · | · | · | · | · | R | · | · | · | · | · | · |
| `/risk` | · | · | · | · | · | · | · | · | · | R | · | · | · |
| `/analytics` | R | R | R | · | R | · | R | R | R | · | · | · | R |
| `/accounting` | R | **RW** | · | · | · | · | · | · | · | · | · | · | · |
| `/communications` | · | · | · | · | · | · | · | · | · | · | · | · | · |
| `/settings` | · | · | · | · | · | · | · | · | · | · | · | R | · |
| `/admin` | · | · | · | · | · | · | · | · | · | · | **RW** | **RW** | · |
| `/profile` | · | · | · | · | · | · | · | · | · | · | · | · | · |

Two rows need a caveat rather than a cell:

- **`/communications`** touches no domain entity through a store. Its data lives in
  `features/communications/lib/communications-store.ts` and `workspace-settings-store`,
  and it has **no read or write path to `Load`**. That is a finding in itself: C7 asserts
  that a message sent from Communications and one sent from a load's Comms tab land in the
  same thread on the same load. The two surfaces do not currently share a store.
- **`/profile`** reads Cognito and company context directly, not a domain entity.

---

## Propagation edges

Every `W` cell, with the surfaces that read the same entity. When the left column writes,
the right column is the assertion target.

| Writer | Entity | Write calls | Surfaces that read it |
|---|---|---|---|
| `/loads` | Load | `updateLoad`, `deleteLoad` | `/dashboard`, `/tracking`, `/accounting`, `/analytics`, driver app |
| `/loads` | TrackSess | `syncTrackingSessionForLoad`, `removeTrackingSessionForLoad` | `/tracking`, `/analytics` |
| `/tracking` | TrackSess | `applyDriverAction`, `reportTrackingException`, `syncTrackingSessionsForLoads` | `/loads`, `/analytics`, driver app **(and `Load` itself — see below)** |
| `/truckboard` | Truck | `updateTruck`, `deleteTruck`, `removeStoredTruckDraft` | `/dashboard` |
| `/bidding` | Load | `createLoad` | every Load reader |
| `/bidding` | BidWksp | `createBidQuote`, `updateBidQuote`, `deleteBidQuote`, `upsertBiddingSavedSearch`, `deleteBiddingSavedSearch` | `/dashboard`, `/analytics` |
| `/rfps` | RFP | `createRfp`, `updateRfp`, `deleteRfp` | `/dashboard` |
| `/rfps` | Quote | `createQuote` | `/quotes`, `/dashboard`, `/analytics` |
| `/quotes` | Quote | `createQuote`, `updateQuote`, `deleteQuote` | `/rfps`, `/dashboard`, `/analytics` |
| `/quotes` | Load | `createLoad` | every Load reader |
| `/quotes` | AdminAudit | `recordAdminAuditLog` | `/settings`, `/admin` |
| `/carriers` | Carrier | `updateCarrier`, `deleteCarrier` | `/dashboard`, `/loads`, `/analytics` |
| `/accounting` | Invoice | `generateInvoiceFromReady`, `submitInvoiceToFactoring`, `markInvoiceDisputed`, `handoffToCollections`, `reconcileFactoringAdvance` | `/analytics` |
| `/admin` | AdminUser, AdminAudit | `createAdminDirectoryUser`, `recordAdminAuditLog` | `/settings`, `/profile` |

**The widest edge is `/tracking` → `Load`,** and it does not appear in the matrix as a `W`
because it is not an imported store call — it happens inside
`session-local.writeSessionToLoad`, which issues `patchLoad(loadId, { trackingSession,
driverWorkflowStatus, loadStatus })`. Tracking therefore writes to the load record that
`/dashboard`, `/loads`, `/accounting` and `/analytics` all read. See below.

---

## Pages that write on read

§2.2 asks for these because a surface that mutates on view cannot be used in
reconciliation logic: its own observation changes the result.

### 1. `/accounting` — creates and deletes invoices when you open it

`buildAccountingSnapshot` runs on page load and:

- `putInvoice(draft)` for every billable load without an invoice, **persisting a new
  financial record** ([accounting-store.ts:676](../src/lib/accounting-store.ts#L676))
- `deleteInvoice(inv.invoiceId)` for any `ready-to-bill` draft whose load is no longer
  billable ([:700](../src/lib/accounting-store.ts#L700))
- `putInvoice(inv)` again for each record migrated out of the legacy `localStorage` key
  ([:565](../src/lib/accounting-store.ts#L565))

Opening a report creates and destroys financial records, attributed to whoever happened to
open the tab. **Excluded from reconciliation until fixed** — already first on the
accounting remediation order.

### 2. `/tracking` — advances load state while the tab is open, with no user action

Worse than the accounting case, and not previously filed.

The board runs a 15-second ticker ([session-local.ts:270-383](../src/lib/tracking-workflow/session-local.ts#L270-L383))
that, for any session in a movable state:

1. **Simulates GPS progress** — `routeProgressPct` increments by 2 / 1.3 / 0.3 / 0.2 per
   tick depending on state, and synthesises a position, speed, heading and ETA.
2. **Fires geofence arrivals off that simulated number.** At `progress >= 20` in
   `en-route-pickup` it calls `applyDriverAction(loadId, "arrived-pickup", { source:
   "geofence" })`; at `>= 90` in `in-transit`, `arrived-delivery`.
3. **Persists.** `applyDriverAction` calls `scheduleCloudPersist(loadId, "immediate", {
   propagateDriverStatus: true })`, which writes `trackingSession`,
   `driverWorkflowStatus` **and `loadStatus`** onto the load record.

So an open Tracking tab moves loads from `dispatched` → `at-pickup` → … in DynamoDB,
attributed to the assigned driver, on invented telemetry. Nobody clicked anything.

Consequences for this suite specifically:

- **Any probe that opens Tracking perturbs the entity it is measuring.** CX-1 status
  agreement cannot be asserted with a Tracking tab open.
- CX-9 provenance is compromised at the source: an `arrived-pickup` event with
  `source: "geofence"` may have come from a real driver ping or from the simulator, and the
  timeline entry does not distinguish them.
- C6 (dwell → dollar) is the chain this most damages. A detention charge traced back to a
  "geofence event" may trace to a number the browser made up.

The initial sync is safe — `syncTrackingSessionForLoad` calls `emit()` with no
`cloudLoadId`, so building a session is local-only. It is the **ticker** that writes.

**Recommendation:** the simulator should not exist outside a demo mode, and certainly must
not persist. Gate it behind an explicit flag, default off, before any cross-surface work.

### 3. Not write-on-read, checked and cleared

- `/loads` — `syncTrackingSessionForLoad` is local-only (`emit()` without a cloud id).
- `/dashboard`, `/analytics` — derive everything; no store writes.
- `/truckboard`, `/carriers`, `/crm`, `/rfps`, `/quotes`, `/risk` — writes are all
  user-initiated.

---

## Fabricated data — the count, before anyone says production-ready

Scanned for the tells (`Math.random`, index arithmetic, seeded generators, `runSimulated*`,
mock transports) across `src/lib`, `src/features` and `src/components`, then classified each
hit by hand. Most were **record-id generation**, which is benign — `Q-482913`, `ACT-k3f9x`.

**Four surfaces present invented values as fact. Two are still live.**

| Surface | What is fabricated | State | Effect on this suite |
|---|---|---|---|
| `/tracking` | GPS position, speed, heading, ETA and `routeProgressPct`, on a 15s ticker — **and geofence arrivals fired from that invented progress, persisted to `loadStatus`** | **LIVE** | Excluded from reconciliation. Poisons C6 at the source and makes CX-1 unassertable with the board open |
| `/crm` prospecting | `runSimulatedDatScan(params, seed)` with `seed = Math.random() * 100000` — the prospecting panel presents simulated DAT lane/prospect results as scan output | **LIVE** | Any chain touching CRM prospecting is measuring a random number generator |
| `/communications` | `getSmsTransport` silently returns `createMockSmsTransport()` whenever the Twilio integration is not connected. A message "sends" successfully and goes nowhere. The only signal is a `console.info` | **LIVE — and the most dangerous of the four** | C7 asserts messages are stored and searchable. They will be. They will also not have been delivered, and nothing in the UI distinguishes the two. §2.3's "comms sent from a load are stored and searchable" would pass on an undelivered message |
| `/accounting` payables | Payable status, due date, quick-pay eligibility and YTD-1099 figures derived from the array index | **REMOVED** | No longer needs excluding |

The comms one deserves separating from the others: fabricated *display* data is a reporting
problem, but a fabricated *transport* means the system reports an outbound action it did not
perform. That is the same class as the payables "Schedule quick-pay" button that toasted
success and persisted nothing. A silent fallback to mock is defensible in local dev and
indefensible without a visible banner in any environment a real user touches — and there is
currently one environment.

**Count for the record: 3 live, 1 removed.**

---

## Dead state handling — values readers handle that nothing can produce

The `cancelled` pattern, applied as a lens across the state model. Each of these is handled
by at least one reader and written by no code path:

| Enum | Dead values | Handled by |
|---|---|---|
| `loadStatus` | **`cancelled`**, **`exception`** | `isLoadBillable` excludes cancelled; `deriveTrackingStateFromLoad` maps cancelled → exception; `isLoadEligibleForTracking` excludes both. The transition table permits reaching them; no UI or API caller does |
| `InvoiceRecord.factoringStatus` | **`draft`**, **`settled`**, **`rejected`** — 3 of 5 declared | Only `submitted` (`submitInvoiceToFactoring`) and `advanced` (`reconcileFactoringAdvance`) are ever written |
| `CarrierPayable.status` | **`scheduled`**, **`paid`** | `scheduled` was written only by the fake quick-pay button, now removed; `paid` never had a writer |
| `InvoiceRecord.paidAt` | the field itself | Declared, read by nothing, written by nothing |

The pattern: **the data model was written ahead of the transitions.** Someone modelled a
complete lifecycle and built a subset of the writers, leaving readers defending against
states that cannot occur. That is not harmless — it reads as coverage. A reviewer seeing
`isLoadBillable` exclude `cancelled` reasonably concludes cancellation is handled, and it
is not implemented at all.

---

## §0.2 — spec'd surfaces, actual state

Checked by grep across `src/`. Two of these are **not** absent, which changes the plan.

| Feature | State | Where |
|---|---|---|
| **Global Search** | **EXISTS**, not as a route | [global-search.ts](../src/lib/global-search.ts), 416 lines, wired into [topbar.tsx](../src/components/topbar.tsx). CX-7 link integrity is testable |
| **Notifications Center** | **EXISTS**, not as a route | [app-notifications-store.ts](../src/lib/app-notifications-store.ts), 271 lines, wired into `notifications-popover.tsx` and `driver-status-notifications-watcher.tsx`. Deep links are testable |
| **Accessorials automation** | **PARTIAL** | [keywordEngine.ts](../src/features/communications/lib/keywordEngine.ts) detects trigger words — the `detention` preset matches `["detention","waiting","detained"]`. Its actions are `flag-thread` and `create-task`, **not** an accessorial draft. So C6's "accessorial draft within 5s" has a trigger and no target |
| **Templates Library** | **absent** | no match for `loadTemplate` / `templatesLibrary` |
| **Routing Guides & Waterfall Tendering** | **absent** | no match for `routingGuide` / `waterfall`; no `Tender` entity |
| **Insurance Marketplace** | **absent** | no match |
| **Maintenance / Receipts / Tax** | **absent** | no match |
| **Quick Create / AI Command Bar** | partial | `logistics-ai` components exist; not assessed in this pass |

## Routes with no spec section

- **`/truckboard`** — a capacity board over a `TruckBoard` DynamoDB table (`truckBoardId`
  key), with its own create dialog and a local draft store. `RW` on `Truck`, read by
  `/dashboard` for counts. Nothing else consumes it; it does not participate in the load
  lifecycle.
- **`/admin`** — user directory and role administration over Cognito plus `AdminUser` /
  `AdminAudit` tables. The only surface that writes an audit row today.
- **`/profile`** — the signed-in user's own Cognito attributes and company context. No
  domain entity.
