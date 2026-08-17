# Load State Machine — as built

Documented from the code on branch `tenant-api-hardening`, not from an intended design.
Every claim below cites the file and line that establishes it. Where the shipped
behaviour differs from the state machine in the build prompt, the difference is called
out inline and repeated in [`NOTES.md`](../NOTES.md).

---

## 0. The headline: there is no load state machine on the server

The build prompt assumes a transition-verb API — `POST /loads/:id/accept` returning
`200` or `409 ALREADY_ACCEPTED`. That API does not exist. What exists is:

| Endpoint | Method | What it enforces |
|---|---|---|
| `/api/loads` | GET/POST/PATCH/DELETE | tenant scoping, server-owned-field rejection, body size |
| `/api/driver/loads/:id` | PATCH | `assignedDriver = <token sub>`, a 6-field write allowlist |
| `/api/invoices` (registry) | GET/POST/PATCH/DELETE | tenant scoping only |

`handleLoadsApiRequest` ([loads-api-proxy.ts:95-171](../src/lib/loads-api-proxy.ts#L95-L171))
is generic CRUD. It validates that `loadId` is a non-empty string on create
([:127](../src/lib/loads-api-proxy.ts#L127)) and rejects `companyId`/`createdBy`/
`createdAt`/`updatedAt` ([:32](../src/lib/loads-api-proxy.ts#L32)). It does not read
`loadStatus`, does not compare it to the stored value, and has no concept of a legal
transition. **A `PATCH` moving a load from `draft` straight to `delivered`, or from
`delivered` back to `draft`, returns `200`.**

Consequences that shape the whole test suite:

- **There is no `409` to assert.** The only statuses the load endpoints emit are
  `200`, `201`, `204`, `400`, `401`, `403` (driver field allowlist only), `404`, `405`,
  `413`, `502`, `503`. `409` appears nowhere in `src/lib`.
- **State legality is advisory and client-side.** `getNextDriverActions(state)`
  ([session-local.ts:1134-1144](../src/lib/tracking-workflow/session-local.ts#L1134-L1144))
  returns the legal action set, and the UI renders buttons from it. `applyDriverAction`,
  the function that actually mutates, never consults it — see §3.
- **§2's ground rule — "every guard must be verified at the API layer with a direct
  authenticated request" — currently has almost nothing to verify.** The tests that
  matter most are the ones that send those requests and document the `200` as a
  failing assertion.

---

## 1. Four vocabularies, one load

There is no single `state` column. A load's position in its lifecycle is spread across
four independent fields, three of which are free-form strings.

| Field | Type in code | Written by | Read by |
|---|---|---|---|
| `loadStatus` | `string` — **no union, no enum** ([loads-store.ts:20](../src/lib/loads-store.ts#L20)) | ops UI, driver portal | everything |
| `driverWorkflowStatus` | `string` ([loads-store.ts:82](../src/lib/loads-store.ts#L82)) | driver portal; dispatcher via one guarded path | driver portal, tracking derive |
| `driverStatusHistory` | `{status, at, by?, byName?}[]` | driver portal (append) | derive fallback |
| `trackingSession.trackingState` | `TrackingState` union ([types.ts:1-11](../src/lib/tracking-workflow/types.ts#L1-L11)) | ops tracking board only | ops tracking board |
| `InvoiceRecord.status` | `InvoiceQueue` union ([accounting-store.ts:17-22](../src/lib/accounting-store.ts#L17-L22)) | accounting UI | accounting UI |

`loadStatus` being `string` rather than a union is the root of most of the mismatch
below: nothing in the type system or at the API boundary constrains it, so the sets of
values *written* and the sets *recognised* have drifted apart.

### 1a. `loadStatus` — values written vs. values recognised

**Offered in the create-load dropdown**
([create-load-constants.ts:75-108](../src/components/loads/create-load/create-load-constants.ts#L75-L108)):
`draft`, `driver-assigned`, `active`, `tendered`, `booked`, `dispatched`, `in-transit`,
`delivered`.

**Also written elsewhere in the app:**

| Value | Written at | Note |
|---|---|---|
| `driver-assigned` | [driver loads-store.tsx:356](../apps/driver-portal/src/lib/loads-store.tsx#L356) on accept | driver's accept writes the *same* value dispatch already set |
| `active` | [driver loads-store.tsx:442-449](../apps/driver-portal/src/lib/loads-store.tsx#L442-L449) on `loaded` / `en-route-delivery` | |
| `delivered` | [driver loads-store.tsx:443](../apps/driver-portal/src/lib/loads-store.tsx#L443) | |
| `draft` | [bidding-page.tsx:857](../src/features/bidding/bidding-page.tsx#L857) | |
| `Booked` | [quotes.tsx:500](../src/routes/quotes.tsx#L500) | **capitalised** — every reader lowercases, so it happens to work |

**Recognised by readers but never written by any UI:** `completed`, `cancelled` /
`canceled`, `pod-uploaded`, `exception`, `en-route-pickup`, `en_route_pickup`,
`at-pickup`, `at_pickup`, `loaded`, `in_transit`, `en-route-delivery`,
`en_route_delivery`, `at-delivery`, `at_delivery`
([session-local.ts:533-549](../src/lib/tracking-workflow/session-local.ts#L533-L549),
[:624-632](../src/lib/tracking-workflow/session-local.ts#L624-L632)).

`completed` and `cancelled` are load-terminal in three separate readers
([derive](../src/lib/tracking-workflow/session-local.ts#L624),
[tracking eligibility](../src/lib/tracking-workflow/session-local.ts#L782-L790),
[billability](../src/lib/accounting-store.ts#L243)) yet are unreachable from any
dropdown. `CANCELLED` in the prompt's diagram maps to a value the UI cannot produce.

### 1b. `driverWorkflowStatus` — the driver portal's vocabulary

`ActiveLoadStatus` ([mock-data.ts:8-17](../apps/driver-portal/src/lib/mock-data.ts#L8-L17)),
strictly ordered by `STATUS_STEPS`:

```
assigned → en-route-pickup → at-pickup → loaded → en-route-delivery → at-delivery → delivered
```

plus the two non-step values `offered` and `declined`, and the two ops-only values
`pod-uploaded` and `completed` that appear in `DRIVER_WORKFLOW_ORDER`
([session-local.ts:573-583](../src/lib/tracking-workflow/session-local.ts#L573-L583))
but not in `STATUS_STEPS`.

`assigned` means **the driver accepted**, not "dispatch assigned". This is the single
most confusing naming collision in the codebase and the direct cause of the open bug in
[`TODO`](../TODO) (see §7).

Advance is strictly one step at a time and cannot skip or reverse:
`nextWorkflowStatus` ([load-mapper.ts:284-288](../apps/driver-portal/src/lib/load-mapper.ts#L284-L288))
returns `STATUS_STEPS[idx + 1]`, and `advanceStatus` refuses to run twice concurrently
for the same load via an in-flight `Set`
([driver loads-store.tsx:431-434](../apps/driver-portal/src/lib/loads-store.tsx#L431-L434)).
**This is the only real transition guard in the system, and it is client-side memory.**

### 1c. `TrackingState` — derived, never authoritative

Ten values ([types.ts:1-11](../src/lib/tracking-workflow/types.ts#L1-L11)), ranked
([session-local.ts:514-525](../src/lib/tracking-workflow/session-local.ts#L514-L525)):

```
waiting-driver 0 → driver-accepted 1 → en-route-pickup 2 → at-pickup 3 → in-transit 4
→ at-delivery 5 → delivered 6 → pod-uploaded 7 → completed 8        exception = -1
```

`exception` is rank `-1`, i.e. it sorts *before* `waiting-driver`. It is a real state in
this enum, not an overlay as §1 of the prompt assumes.

---

## 2. The real transition graph

### 2a. Driver-portal advance (the only ordered path)

```
                    ┌──────────────────────────────────────┐
   dispatch sets    │  loadStatus = driver-assigned        │
   assignedDriver   │  driverWorkflowStatus = (unset)      │  ← derives to waiting-driver
                    └───────────────┬──────────────────────┘
                          accept    │              decline
              loadStatus=driver-assigned      driverWorkflowStatus=declined
              driverWorkflowStatus=assigned   (loadStatus untouched)
                                    │                     │
                                    ▼                     ▼
                              [assigned]            [declined] ──derives──▶ exception
                                    │  advanceStatus (one step, no skip, no reverse)
                                    ▼
                            en-route-pickup
                                    ▼
                               at-pickup
                                    ▼
                                 loaded ─────────── loadStatus := active
                                    ▼
                          en-route-delivery ─────── loadStatus := active
                                    ▼
                              at-delivery
                                    ▼
                              delivered ─────────── loadStatus := delivered
                                    ▼
                              (end of STATUS_STEPS — nextWorkflowStatus → null)
```

`pod-uploaded` and `completed` are **not** reachable from the driver portal.
`advanceStatus` stops at `delivered`. They are written only by the ops tracking board's
write-through (§3).

### 2b. Ops tracking board — `TrackingState`, derived then locally mutated

`deriveTrackingStateFromLoad`
([session-local.ts:622-685](../src/lib/tracking-workflow/session-local.ts#L622-L685))
resolves the four fields in a fixed precedence. This ordering is the contract:

1. `loadStatus === "completed"` → `completed`; `cancelled`/`canceled` → **`exception`**
   (there is no distinct cancelled tracking state).
2. `loadStatus === "delivered"` → `pod-uploaded` if a POD document exists, else
   `delivered`. POD presence = `documentAssets[].kind === "pod"` **or**
   `documents[].startsWith("pod:")`.
3. `driverWorkflowStatus` mapped ([:635-663](../src/lib/tracking-workflow/session-local.ts#L635-L663)).
   `assigned`/`accepted`/`driver-accepted` → `driver-accepted`; `loaded` → `at-pickup`
   (**collapsed**); `en-route-delivery`/`in-transit` → `in-transit`; `declined` → `exception`.
4. Last entry of `driverStatusHistory`, recursed — used only if it yields something
   other than `waiting-driver`.
5. `TRACKING_STATE_BY_LOAD_STATUS` ([:533-549](../src/lib/tracking-workflow/session-local.ts#L533-L549)).
   `driver-assigned`, `active`, `booked` and `tendered` are **deliberately absent** so
   dispatch's own act does not read as driver acceptance.
6. Fallback `waiting-driver`.

Two states are lossy on the way in — `loaded` and `at-pickup` both derive to
`at-pickup`; `en-route-delivery` and `in-transit` both derive to `in-transit` — which is
why the write-back needs a non-regression guard.

### 2c. Write-back, ops → driver

`driverWorkflowForCloudWrite(state, current)`
([session-local.ts:589-603](../src/lib/tracking-workflow/session-local.ts#L589-L603)):

- Maps via `DRIVER_WORKFLOW_BY_TRACKING_STATE` ([:559-570](../src/lib/tracking-workflow/session-local.ts#L559-L570)).
  `waiting-driver` and `exception` map to nothing and write nothing — neither describes
  something the driver reported.
- Refuses to move the driver backwards along `DRIVER_WORKFLOW_ORDER` (`to < from` →
  `undefined`).
- Only fires when `propagateDriverStatus: true`, which is set **only** by
  `applyDriverAction` ([:1188](../src/lib/tracking-workflow/session-local.ts#L1188),
  [:1283](../src/lib/tracking-workflow/session-local.ts#L1283)). Background polls,
  tickers and session rebuilds never touch the field
  ([:172-180](../src/lib/tracking-workflow/session-local.ts#L172-L180)).

`writeSessionToLoad` writes exactly `{ trackingSession, driverWorkflowStatus }`
([:180](../src/lib/tracking-workflow/session-local.ts#L180)). **It never writes
`loadStatus`.** So a dispatcher walking a load to `delivered` on the tracking board
leaves `loadStatus` at whatever it was — and `isLoadBillable` reads `loadStatus`
([accounting-store.ts:242-252](../src/lib/accounting-store.ts#L242-L252)), with a
fallback on `driverWorkflowStatus === "delivered"` that happens to save it.

### 2d. Invoice lifecycle

`InvoiceQueue` ([accounting-store.ts:17-22](../src/lib/accounting-store.ts#L17-L22)) —
a flat set with no transition table:

```
ready-to-bill ──generateInvoiceFromReady──▶ sent ──submitInvoiceToFactoring──▶ factored
      │                                      │                                    │
      │                                 markInvoiceDisputed              reconcileFactoringAdvance
      │                                      ▼                        (factoringStatus: submitted→advanced)
      │                                 in-dispute
      └──────────────── handoffToCollections ────────────▶ sent-to-collections
```

There is **no `PAID` state**. `paidAt` exists as an optional field
([:56](../src/lib/accounting-store.ts#L56)) and nothing sets it. There is no payment
webhook handler anywhere in `src/lib`, so §7's "webhook replay is idempotent" and §8's
"payment webhook marks paid" have no subject.

Only two guards exist: `generateInvoiceFromReady` throws if `!podOnFile` and the
`require_pod_before_invoice` setting is on ([:528-530](../src/lib/accounting-store.ts#L528-L530)),
and `submitInvoiceToFactoring` throws if status is still `ready-to-bill`
([:560-562](../src/lib/accounting-store.ts#L560-L562)). Both are thrown `Error`s in
browser code, not HTTP responses. `handoffToCollections`, `markInvoiceDisputed` and
`upsertInvoice` are unguarded — any status can jump to any other via `PUT /api/invoices/:id`.

---

## 3. `applyDriverAction` is unguarded — the transition matrix

`applyDriverAction(loadId, action, opts)`
([session-local.ts:1146-1286](../src/lib/tracking-workflow/session-local.ts#L1146-L1286))
is the reducer the ops Driver Actions row calls. Its only rejection is a missing session
(`if (!current) return null`, [:1153](../src/lib/tracking-workflow/session-local.ts#L1153)).
It then does `next.trackingState = stateByAction[action] ?? next.trackingState`
([:1223-1224](../src/lib/tracking-workflow/session-local.ts#L1223-L1224)) with **no
reference to the current state and no rank comparison.**

Legend — `A` action is in `getNextDriverActions(state)` and applies;
`U` **unguarded**: not advised for this state, applies anyway;
`D` decline-from-anywhere, by design (`reportTrackingException`,
[:1288-1294](../src/lib/tracking-workflow/session-local.ts#L1288-L1294));
`—` terminal state, advisor returns `[]`, action still applies.

| from \ action | accept | decline | start-route | arr-pickup | checkin-pickup | loaded | depart-pickup | in-transit | arr-delivery | checkin-delivery | delivered | upload-pod | complete |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **waiting-driver** | A | A | U | U | U | U | U | U | U | U | U | U | U |
| **driver-accepted** | U↺ | D | A | U | U | U | U | U | U | U | U | U | U |
| **en-route-pickup** | U↓ | D | U↓ | A | U | U | U | U | U | U | U | U | U |
| **at-pickup** | U↓ | D | U↓ | U↺ | A | A | A | U | U | U | U | U | U |
| **in-transit** | U↓ | D | U↓ | U↓ | U↓ | U↓ | U↺ | U↺ | A | U | U | U | U |
| **at-delivery** | U↓ | D | U↓ | U↓ | U↓ | U↓ | U↓ | U↓ | U↺ | A | A | U | U |
| **delivered** | U↓ | D | U↓ | U↓ | U↓ | U↓ | U↓ | U↓ | U↓ | U↓ | U↺ | A | U |
| **pod-uploaded** | U↓ | D | U↓ | U↓ | U↓ | U↓ | U↓ | U↓ | U↓ | U↓ | U↓ | U↺ | A |
| **completed** | U↓ | D | U↓ | U↓ | U↓ | U↓ | U↓ | U↓ | U↓ | U↓ | U↓ | U↓ | U↺ |
| **exception** | U↑ | D↺ | U↑ | U↑ | U↑ | U↑ | U↑ | U↑ | U↑ | U↑ | U↑ | U↑ | U↑ |

`↓` = the resulting state has a **lower** `TRACKING_STATE_RANK` than the state it left:
120 of the 130 cells apply, and 55 of those walk the load backwards. `↺` = self-loop.
`↑` = climbs out of `exception` with no reassignment.

Three partial mitigations blunt the blast radius, and each needs its own test:

1. `routeProgressPct` is monotonic — `Math.max(next.routeProgressPct, progressByAction[action])`
   ([:1225-1228](../src/lib/tracking-workflow/session-local.ts#L1225-L1228)). So a
   `delivered` session reset to `driver-accepted` keeps `routeProgressPct: 98` while
   displaying "Driver Accepted". The UI and the progress bar disagree.
2. The persisted `driverWorkflowStatus` **is** protected, by
   `driverWorkflowForCloudWrite`'s non-regression check. The regression is local +
   `trackingSession` only.
3. `applyDerivedTrackingState` refuses `exception → waiting-driver`
   ([:691-693](../src/lib/tracking-workflow/session-local.ts#L691-L693)) — but only on
   the *derive* path, not on `applyDriverAction`.

`syncTrackingSessionsForLoads` re-derives only when `load.updatedAt` changed
([:744-748](../src/lib/tracking-workflow/session-local.ts#L744-L748)), so a corrupted
local state persists until the next genuine load write.

### 3a. The same matrix at the wire

Repeat every cell as a direct authenticated `PATCH`, per §2's second ground rule:

| Request | Actual result |
|---|---|
| `PATCH /api/loads/:id {loadStatus:"delivered"}` on a `draft` load | **`200`** |
| `PATCH /api/loads/:id {loadStatus:"draft"}` on a `delivered` load | **`200`** |
| `PATCH /api/loads/:id {loadStatus:"totally-invented"}` | **`200`** |
| `PATCH /api/loads/:id {customerRate:"1.00"}` on a `delivered` load | **`200`** |
| `PATCH /api/driver/loads/:id {driverWorkflowStatus:"delivered"}` from `assigned` | **`200`** (skips 5 steps) |
| `PATCH /api/driver/loads/:id {customerRate:"1.00"}` | `403 field_not_writable` ✅ |
| `PATCH /api/loads/:id {companyId:"other"}` | `400 server_owned_field` ✅ |
| `GET /api/loads/:id` as another tenant | `404 not_found` ✅ |
| `GET /api/driver/loads/:id` for an unassigned load | `404 not_found` ✅ |
| `PATCH /api/driver/loads/:id` for a load reassigned mid-flight | `404 not_found` ✅ (`ConditionExpression`) |

The five `200`s are the matrix's real findings. The suite should assert the *correct*
behaviour and be committed failing, per §10's last checkbox.

---

## 4. Authorization: tenant-scoped, not role-scoped

Tenant isolation is genuinely well built and worth testing as a strength.
`createTenantRepository` ([tenant-repository.ts:110-267](../src/lib/server/tenant-repository.ts#L110-L267))
takes a `TenantContext` as the first argument of every method, has no `Scan`, carries
`companyId = :ctxCompany` inside the same `ConditionExpression` as each write, and
reports a cross-tenant miss as `404` rather than `403`
([:53-63](../src/lib/server/tenant-repository.ts#L53-L63)). `requireCurrentTenantContext`
additionally checks a stored `sessionEpoch` so a revoked session fails within the
60-second role-cache TTL rather than at token expiry
([request-context.ts:38-53](../src/lib/tenant/request-context.ts#L38-L53)).

**Role is not checked on any load or invoice endpoint.** `handleLoadsApiRequest` calls
`requireCurrentTenantContext` and never inspects `ctx.role`. The ten roles
([admin-user-constants.ts:24-35](../src/lib/admin-user-constants.ts#L24-L35): Organization
Owner, Admin, SuperAdmin, Operations Manager, Broker, Dispatcher, Driver, Accounting,
Sales, Marketing) are enforced on the admin surfaces only — `admin-role-proxy`,
`admin-users-proxy`, `admin-company-proxy`.

So for §3's authorization matrix, the honest expected values today are:

| Actor | `GET /api/loads` | `PATCH /api/loads/:id` | `POST /api/invoices` |
|---|---|---|---|
| Broker, own tenant | `200` | `200` | `200` |
| Accounting, own tenant | `200` | **`200`** — can rewrite rates | `200` |
| Sales / Marketing, own tenant | **`200`** | **`200`** | **`200`** |
| Driver (tenant-exempt, no `companyId`) | `403` via `requireCompanyId` — confirm | n/a | confirm |
| Other tenant | `404` ✅ | `404` ✅ | `404` ✅ |
| Unauthenticated | `401 not_authenticated` ✅ | `401` ✅ | `401` ✅ |

There is **no `client` / customer-portal role**. §5 and §7 both require asserting that
`client` payloads carry no rate or margin data; there is no such principal to
authenticate as. What exists is `trackingSession.customerTrackingLink`
([types.ts:100](../src/lib/tracking-workflow/types.ts#L100)) — and
`toTrackingSessionCloud` strips only `messages`, `documents` and `viewUrl`
([session-local.ts:86-92](../src/lib/tracking-workflow/session-local.ts#L86-L92)), so
the session object retains `customer` and `carrier`. Whether that link is
unauthenticated is the open question in `NOTES.md`.

---

## 5. Concurrency: what the store actually guarantees

| Mechanism | Where | Covers |
|---|---|---|
| `attribute_not_exists(idKey)` on create | [tenant-repository.ts:187](../src/lib/server/tenant-repository.ts#L187) | duplicate `loadId` create |
| `attribute_exists AND companyId = :ctxCompany` on update/delete | [:233](../src/lib/server/tenant-repository.ts#L233), [:256](../src/lib/server/tenant-repository.ts#L256) | record changing hands between read and write |
| `attribute_exists AND assignedDriver = :owner` | [driver-loads-proxy.ts:183](../src/lib/driver-loads-proxy.ts#L183) | driver writing a reassigned load |
| in-flight `Set` on driver advance | [driver loads-store.tsx:433](../apps/driver-portal/src/lib/loads-store.tsx#L433) | double-tap, **same tab only** |
| `cloudPersistInFlight` Set | [session-local.ts:156](../src/lib/tracking-workflow/session-local.ts#L156) | overlapping write-throughs, same tab |

What is absent:

- **No version / optimistic-concurrency attribute.** `update` sets named attributes with
  no `#version = :expected` predicate, so two concurrent `PATCH`es to the same load are
  last-write-wins per attribute. Two dispatchers advancing the same load cannot conflict —
  they interleave.
- **No idempotency keys.** Nothing in `src/lib` reads an `Idempotency-Key` header. §4's
  "two accept requests with the same idempotency key" has no mechanism to exercise.
- **No carrier-assignment row.** Assignment is the scalar `assignedDriver` /
  `assignedCarrier` on the load item. "The load has exactly one carrier assignment row"
  is vacuously true and cannot detect a double-accept.
- **No tender waterfall, no offer, no `expiresAt`.** `tendered` is a `loadStatus` string
  and nothing more. There is no offer record, no expiry timestamp, no expiry job, and no
  next-carrier notification. §4's expiry and waterfall tests have no subject.
- **Invoice numbering is not sequential.** `createInvoiceId`
  ([accounting-store.ts:329-334](../src/lib/accounting-store.ts#L329-L334)) is
  `` `${prefix}${loadId}-${Date.now().toString(36).toUpperCase().slice(-5)}` ``. Two
  invoices created for the same load in the same ~1.2ms window collide on id, and
  `putInvoice` is a `PutCommand` without `attribute_not_exists`, so the second silently
  overwrites the first. §7's "50 parallel creates yield a contiguous range" will fail;
  the achievable assertion is "50 parallel creates yield 50 distinct persisted invoices",
  and that is the bug.

---

## 6. Money: floats and strings end to end

§7 requires integer minor units throughout. The code stores neither integers nor minor
units.

- Every rate field on `LoadRecord` is `string` — `customerRate`, `carrierRate`,
  `linehaulRate`, `fuelSurcharge`, `accessorialCharges`, `detentionRate`, `lumperFee`,
  `tonuFee`, `layoverFee`, `loadValue`
  ([loads-store.ts:69-78](../src/lib/loads-store.ts#L69-L78)).
- `parseMoney` ([accounting-store.ts:131-135](../src/lib/accounting-store.ts#L131-L135))
  strips everything outside `[0-9.-]` and `Number()`s the remainder. `"1,847.30"` →
  `1847.30`. `"$1.2.3"` → `NaN` → `0`. `"(500)"` → `500`, sign lost. A non-numeric rate
  silently becomes zero on an invoice.
- `moneyRound(n) = Math.round(n * 100) / 100`
  ([:137-139](../src/lib/accounting-store.ts#L137-L139)) — float dollars, applied
  per-line then again to the subtotal.
- `InvoiceLineItem.amount` and `InvoiceRecord.{subtotal,tax,total}` are `number`
  ([:38](../src/lib/accounting-store.ts#L38), [:49-51](../src/lib/accounting-store.ts#L49-L51))
  and are persisted to Dynamo as such. `Number.isInteger` is false for effectively every
  stored money value.
- `money()` formats with `maximumFractionDigits: 0`
  ([:642-648](../src/lib/accounting-store.ts#L642-L648)) — cents are invisible in most of
  the UI, so the $1,847.29-vs-.30 class of bug cannot be seen on screen.
- No `currency` field on `InvoiceRecord`; `money`/`moneyExact` hardcode `en-US`/`USD`.
  No FX anywhere.
- `tax = moneyRound(subtotal * 0)` ([:314](../src/lib/accounting-store.ts#L314)) — tax is
  hardwired to zero at draft time and only settable via a manual `edits.tax`.

The reconciliation identity §7 wants **does** hold internally: `totalsFromLines`
([:321-327](../src/lib/accounting-store.ts#L321-L327)) recomputes `subtotal`/`tax`/`total`
from the lines on every write, so `total === Σ lines` is a real invariant worth a
property test. What does not hold is the second half —
`total === rate_confirmation.total + Σ post_delivery_charges - Σ credits` — because there
is no rate-confirmation record, no post-delivery-charge record, and no credit concept.
`buildDraftLinesFromLoad` reads rates off the load *at draft time*
([:261-319](../src/lib/accounting-store.ts#L261-L319)) and `linehaul` falls back
`customerRate || linehaulRate || carrierRate`
([:263](../src/lib/accounting-store.ts#L263)) — **so a load with no `customerRate` bills
the carrier's rate to the customer.** Also every line is gated `if (x > 0)`, so a
negative accessorial or credit is dropped without trace.

Post-delivery immutability does not exist: rates live on the mutable `LoadRecord` and
`PATCH /api/loads/:id` accepts them at any status, including after the invoice is `sent`.
Editing a delivered load's rate does not change an already-persisted invoice — the
invoice is a snapshot — but it does change what a *re-drafted* invoice says, with no
version link and no audit trail. That is the fourth bug in §0 of the prompt, live.

---

## 7. Tracking: simulated, not measured

- **No geofencing.** The two `source: "geofence"` timeline events
  ([session-local.ts:342-368](../src/lib/tracking-workflow/session-local.ts#L342-L368))
  fire on `routeProgressPct >= 20` and `>= 90`, where progress is incremented by a
  `setInterval` ticker (`+2`, `+1.3`, `+0.3`, `+0.2` per tick,
  [:289-293](../src/lib/tracking-workflow/session-local.ts#L289-L293)). No radius, no
  distance calculation, no dwell, no debounce. §5's boundary-at-radius-±1m and
  six-crossings-in-two-minutes tests have no subject.
- **No ping stream.** `driverGps` is a **single** `DriverGpsPing` object on the load
  ([driver-gps.ts:3-13](../src/lib/driver-gps.ts#L3-L13)), overwritten each share. There
  is no ping table, so "200 backdated pings replayed" cannot be stored, cannot be
  ordered, and cannot be deduplicated. Sharing is throttled to one per 10 minutes
  ([:15](../src/lib/driver-gps.ts#L15)).
- **`accuracyM` is recorded and never read.** It exists on the ping type
  ([:6](../src/lib/driver-gps.ts#L6)) and on `TrackingSession.gps`
  ([types.ts:112](../src/lib/tracking-workflow/types.ts#L112)). No code branches on it.
  §5's ">100m cannot trigger arrival" is not currently expressible — arrival is triggered
  by simulated progress, not by position at all.
- **Freshness, not staleness.** `isDriverGpsFresh` returns true within 15 minutes
  ([driver-gps.ts:20-31](../src/lib/driver-gps.ts#L20-L31)) and is used to decide whether
  live GPS beats the simulator. There is no stale-load flag and no alert.
- **No arrival-before-departure enforcement.** `depart-pickup` from any state, per §3's
  matrix.
- **Device clock is authoritative.** `lastPingAt` and every `driverStatusHistory.at` are
  stamped client-side with `new Date().toISOString()`. There is no `deviceReportedAt` /
  server-timestamp split, so a device three hours off reorders the event stream. Timeline
  merge sorts by that client string
  ([session-local.ts:1123](../src/lib/tracking-workflow/session-local.ts#L1123)).
- **No offline queue.** Nothing in `apps/driver-portal` implements one — no
  `navigator.onLine` branch, no IndexedDB, no retry, no dead-letter. `acceptLoad`,
  `declineLoad` and `advanceStatus` all `await` the `PATCH` and show a toast on failure
  ([driver loads-store.tsx:372-376](../apps/driver-portal/src/lib/loads-store.tsx#L372-L376),
  [:408-419](../apps/driver-portal/src/lib/loads-store.tsx#L408-L419),
  [:460-464](../apps/driver-portal/src/lib/loads-store.tsx#L460-L464)). `declineLoad` is
  the one place with a real optimistic-update rollback, and it is worth an E2E test
  exactly as §4 describes. All of §5's offline-queue unit tests — ordering, persistence
  across restart, dead-lettering, clock skew — have no subject.
- The one persisted client state is `driver-portal.declined-loads` in `localStorage`
  ([:97](../apps/driver-portal/src/lib/loads-store.tsx#L97)), a per-driver id set. A
  decline that fails the network is rolled back out of it.

### 7a. The open bug in `TODO`

> *"in tracking loads — when the user has assigned loads the status is still Awaiting Driver"*

This is the documented behaviour of derive step 5: `driver-assigned`, `active`, `booked`
and `tendered` are intentionally excluded from `TRACKING_STATE_BY_LOAD_STATUS` so that
dispatch's own act does not read as driver acceptance
([session-local.ts:527-532](../src/lib/tracking-workflow/session-local.ts#L527-L532)).
The naming collision makes it look like a bug: the driver portal writes
`driverWorkflowStatus = "assigned"` to mean *"the driver accepted"*
([driver loads-store.tsx:357](../apps/driver-portal/src/lib/loads-store.tsx#L357)), while
`loadStatus = "driver-assigned"` means *"dispatch assigned, driver has not answered"*.
Both read as "assigned" on screen.

The real gap is that there is no distinct tracking state for "assigned, awaiting
driver response" versus "not yet assigned" — `waiting-driver` covers both, and the label
is `"Waiting for Driver"` ([types.ts:127](../src/lib/tracking-workflow/types.ts#L127)).
See `NOTES.md` Q1 for the recommendation.

---

## 8. Reconciled diagram — what the code actually implements

```
  loadStatus:  draft ─▶ tendered ─▶ booked ─▶ driver-assigned ─▶ active ─▶ delivered
               (free-form string; any value → any value via PATCH, 200)
                            │
                            │  dispatch sets assignedDriver
                            ▼
  driverWorkflowStatus:  (unset) ──accept──▶ assigned ──▶ en-route-pickup ──▶ at-pickup
                            │                                                     │
                         decline                                                loaded
                            ▼                                                     ▼
                        declined                                        en-route-delivery
                                                                                  ▼
                                                                            at-delivery
                                                                                  ▼
                                                                             delivered ─┐
                            (driver portal stops here) ───────────────────────────────  │
                                                                                        │
  TrackingState:  derived from the three fields above, then freely                       │
                  mutated by applyDriverAction with no guard  ◀───────────────────────── ┘
                  waiting-driver ⇄ driver-accepted ⇄ en-route-pickup ⇄ at-pickup
                    ⇄ in-transit ⇄ at-delivery ⇄ delivered ⇄ pod-uploaded ⇄ completed
                    ⇄ exception          (⇄ : every pair, both directions)

  InvoiceQueue:   ready-to-bill ─▶ sent ─▶ factored ─▶ (factoringStatus: advanced)
                        └────────▶ in-dispute        └──▶ sent-to-collections
                        (no PAID state; any status → any status via PATCH)
```

Against §1's expected diagram: `READY`, `TENDERED`-as-a-state, `ACCEPTED`, `LOADED`,
`EN_ROUTE_DELIVERY` as distinct from `in-transit`, `READY_TO_INVOICE`, `INVOICED`,
`PAID`, and `CANCELLED`-as-reachable do not exist. `EXCEPTION` exists but as a peer
state, not an overlay. `DRAFT`, `AT_PICKUP`, `AT_DELIVERY` and `DELIVERED` map cleanly.

---

## 9. What this means for the suite

Ordered by value, given the above:

1. **Wire-level matrix tests against `/api/loads` and `/api/driver/loads`** — the §3a
   table. These are the tests that would have caught bugs 1 and 4 from §0. They will be
   committed failing.
2. **Money property tests** over `parseMoney` / `moneyRound` / `buildDraftLinesFromLoad`
   / `totalsFromLines`. The `total === Σ lines` invariant is real and holds; the float
   drift, the `customerRate || carrierRate` fallback, the dropped negatives and the
   `parseMoney` parse failures are all provable now with fast-check.
3. **Derive-precedence tests** extending the existing
   [derive-state.test.ts](../src/lib/tracking-workflow/derive-state.test.ts), which is
   already good and already encodes one real regression. The six-step precedence in §2b
   is the contract to lock down.
4. **`applyDriverAction` reducer matrix** — 130 generated cells, asserting the guard that
   should exist. All 120 currently-applying cells fail.
5. **Tenant isolation tests** — the one area that will mostly pass, and is worth locking
   in before anything else changes.
6. **Invoice-numbering collision test** — 50 parallel creates, assert 50 distinct
   persisted records. Fails today.

Deferred until the subject exists, tracked in `NOTES.md`: offer expiry, tender waterfall,
idempotency keys, offline queue, real geofencing, ping stream, detention, POD
immutability, OS&D, multi-stop, `client` role, payment webhooks, PDF generation.

Test-infrastructure reality check: `vitest` is the only test tool installed. There is no
`playwright`, no `msw`, no `supertest`, no `fast-check`, no `@vitest/coverage`
(`package.json`), and `vitest.config.ts` has `environment: "node"` with an `include` glob
limited to `src/**` and `apps/*/src/**` — the `tests/` tree in §9 of the prompt is not
currently collected. Deliverable 2 covers adding those and widening the glob.
