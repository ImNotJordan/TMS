# NOTES — load lifecycle test suite

Findings from reading the code for [`docs/load-state-machine.md`](docs/load-state-machine.md).
Nothing here is speculation; every entry cites the line that establishes it.

Three sections: **bugs** (defects with a failing test to be committed), **gaps** (the
prompt asks for a test whose subject does not exist), **open questions** (a business rule
someone has to decide before a test can assert anything).

---

## BLOCKER — `npm run build` fails; the app cannot be deployed

Reproduced on a **clean tree at `356eb50`** with all local work stashed, so this is
pre-existing and not introduced by any change in this engagement.

```
✗ Build failed in 19.69s
node_modules/@aws-sdk/credential-provider-login/dist-es/LoginCredentialsFetcher.js (5:9):
"promises" is not exported by "__vite-browser-external"
```

`src/lib/ai/cognito-request-credentials.ts` imports `fromCognitoIdentityPool` from
`@aws-sdk/credential-providers`. That package pulls in `@aws-sdk/credential-provider-login`,
which imports `node:fs`, `node:os`, `node:path` and `node:crypto` — Node-only modules Vite
stubs out for the browser bundle. Rollup then fails on the missing `promises` export.

`vite dev` does not fail, because dev serves modules unbundled and never resolves the
externalised stub. So the app runs locally and **cannot be built for production**.

Three ways out, in preference order:

1. **Move the credential provider server-side.** `fromCognitoIdentityPool` mints AWS
   credentials for the *browser* — the same browser-holds-IAM-credentials pattern that
   `356eb50` was explicitly written to remove ("strip browser IAM grants"). This import may
   simply be a leftover of the work that commit began. Check whether anything still needs it;
   if not, deleting it fixes the build and finishes that migration.
2. Narrow the import to a browser-safe entry point, if one exists in the SDK version pinned.
3. Alias the Node builtins in the Vite config. Works, and hides the real problem.

Worth noting for the test programme: **no CI job runs `npm run build`.** `npm run verify`
is `tsc && vitest && check-tenant-guard` — all three pass. A green verify has never implied
a shippable artifact.

---

## BLOCKER — there is no environment separation

**This outranks everything else on the accounting plan, including the invoice
authorization work.** Bare table names (`Loads`, `Invoices`, `TrackingMessages`,
`CrmAccounts` — no stage prefix), a single `.env`, and no `env` blocks in
`wrangler.jsonc`. Local development and any deployment read and write the same tables
under the same AWS account.

It is not infrastructure cleanup to do later — it is the **precondition for the test
programme**. The brief's §2.6 calls for twenty-iteration concurrency loops on invoice
creation; that is hundreds of financial records written to the only table that exists.
The characterization/contract split assumes a dataset we are allowed to break. We do not
have one.

**No further live probing until this lands.**

Four items, in order:

1. Stage-prefixed table names resolved from env in the registry — `{stage}-Loads`,
   `{stage}-Invoices`, every table, no per-table opt-outs.
2. `.env.development` / `.env.staging` / `.env.production`, `env` blocks in
   `wrangler.jsonc`, stage resolved from the environment and **never defaulted in
   code** — a missing stage variable fails startup loudly rather than falling through
   to production.
3. A hard guard refusing any delete or bulk write when the resolved stage is
   production, unless an explicit flag is passed. The registry change is the fix; the
   guard is what survives someone's shell having the wrong env loaded.
4. A dev seed script, so a fresh developer gets a working dataset without touching
   real tables.

### Lesson: enumerate every table before writing to any

I checked `Loads` and `Invoices`, found both empty, and reported "a fresh tenant, no
production data at risk". `CrmAccounts` held two records created 2026-08-07 and updated
2026-08-10 — the tenant is somebody's workspace, not a scratch pad. The conclusion was
right about the two tables I wrote to and wrong as a statement about the tenant, because
I generalised from the two I happened to look at.

The rule is: enumerate **every** table in the registry before the first write, not the
ones the task expects to touch. Cheap, and it is the difference between a bounded claim
and an unbounded one.

### Open: whose are the CrmAccounts records?

`ACC-6893`'s `createdBy` begins `0949294e-` — the same Cognito sub as the ops account
used for testing, so at least that one is self-created. `ACC-1390`'s `createdBy` was not
captured. **To be answered after stage separation**, before any further change: if a real
user has been working in this tenant, this is production-with-users and the standard for
every subsequent change rises.

### Decided: AR and AP profiles are separate, both keyed to `accountId`

`crm-accounts` is a real persisted entity (`CrmAccounts` table, `accountId` key,
`companyId-index`, CRUD through the same tenant-scoped proxy as invoices) — **not**
fabricated like payables were. It is therefore the customer of record: single identity,
no parallel master.

`CrmAccountRecord` carries identity and contact only — no billing attributes at all — so
nothing moves out of CRM and there is no ownership to negotiate. `accountType` includes
`Broker` and `Carrier`, so it is a **party** master rather than a customer master.

Two role-scoped profiles, owned by accounting, keyed to `accountId`. An account may have
neither, either, or both — in freight a party is routinely both customer and carrier, and
collapsing them is how a credit limit gets applied to a payable or a factoring NOA to a
receivable.

| AR profile | AP profile |
|---|---|
| payment terms, credit limit, required documents, billing deadline days, billing contact, invoice delivery method | remit-to, factoring status, factor name, NOA on file, quick-pay eligibility and rate, W-9 on file, insurance expiry, authority status |

**Open question, not being built:** AR/AP netting for a party that is both. Flagged
deliberately — netting has tax and contractual consequences and needs a decision, not a
default.

### Owed: re-run the invoice authorization proof as a low-privilege role

The §0.2 transcript in [accounting-findings.md](docs/accounting-findings.md) was run as
**SuperAdmin**. The finding is correct — `resource-proxy` never reads `ctx.role`, so the
principal is irrelevant to the outcome — but a SuperAdmin deleting an invoice reads as an
admin doing admin things to anyone skimming. Once there is a safe stage, re-run the
identical three requests as **Marketing or Sales** and make that the headline transcript,
with the SuperAdmin run kept as an appendix. A Marketing user rewriting a sent invoice
from $3,265.50 to $1.00 and then deleting it is the version nobody argues with.

---

## Manifest — records written to real AWS during testing

Every write below went to the **only** environment that exists (see "Environment" below).
Test records are prefixed `TEST-CLAUDE-` without exception, so they are trivially
identifiable and removable.

**Tenant:** `d06f5f2d-b15e-4b4b-b787-b4a5cc20a7f3`  ·  **Actor:**
`0949294e-9091-7068-5783-47fd272997ec` (SuperAdmin)  ·  **Region:** `us-west-1`  ·
**AWS account:** `115313776737`  ·  **Cognito pool:** `us-west-1_1CZpzcipb`

| Table | Created by me | Deleted by me | Pre-existing records touched |
|---|---|---|---|
| `Loads` | 12–14 `TEST-CLAUDE-*` (lifecycle runs, reassignment probes, GSI-lag probes) | all but 2 | **none — the table held 0 loads before this work** |
| `Invoices` | 4 `INV-TEST-CLAUDE-*` incl. the `AUTHZ` probe | 2 | **none — the table held 0 invoices before this work** |
| `TrackingMessages` | 2, on `TEST-CLAUDE-MSTH1GYH` | 0 (the cleanup script does not cover this table) | none |
| `CrmAccounts` | 0 | 0 | **read only** — `ACC-6893`, `ACC-1390` were listed once by the manifest script and never written |

**Still present, deliberately** (the requested demo scenario, plus one run's residue):
`TEST-CLAUDE-MSTH1GYH` + `INV-TEST-CLAUDE-MSTH1GYH` + 2 tracking messages;
`TEST-CLAUDE-MSUTC2SB` + `INV-TEST-CLAUDE-MSUTC2SB`.
Remove with `node sim.local/live/cleanup.mjs <loadId>` — note it deletes the load and its
invoice but **not** tracking messages.

**Accounting purge, 2026-08-16T20:02:31Z** — at the owner's request, to start fresh.
Removed both invoices then present, each verified as testing-created before deletion:

| invoiceId | status | total | load | issued |
|---|---|---|---|---|
| `INV-TEST-CLAUDE-MSUTC2SB` | factored | 3265.50 | `TEST-CLAUDE-MSUTC2SB` | 2026-08-15T20:21:31Z |
| `INV-TEST-CLAUDE-MSTH1GYH` | factored | 3265.50 | `TEST-CLAUDE-MSTH1GYH` | 2026-08-15T20:36:36Z |

Both `204`; the table read back empty. `Loads` was already at 0 — the loads were removed
outside this work between 2026-08-15 and the purge, so nothing regenerates a draft.

Note both had been issued and factored through the UI, so they were **not** auto-generated
drafts — the one category §1.3.5 exempts from "no deletes". They were testing artifacts
referencing loads that no longer existed, in a table with no other records, so the purge
was safe. It is the last deletion that should happen through an app path: once void
exists, this is a void with a reason and an approver, not a `DELETE`.

**The $3,265.50 invoice** from the authorization proof (§0.2 of
[accounting-findings.md](docs/accounting-findings.md)) was `INV-TEST-CLAUDE-AUTHZ-*`,
created and deleted inside a single probe. It was never a real receivable, was never sent,
and referenced load id `"probe"`, which does not exist.

### Environment

There is **no environment separation.** Table names are bare — `Loads`, `Invoices`,
`TrackingMessages`, `CrmAccounts` — with no stage prefix or suffix; there is a single
`.env` with no `.env.staging` or `.env.production`; and `wrangler.jsonc` declares no `env`
blocks. Local development, and any deployment, read and write the same tables under the
same AWS account.

I judged the writes safe because `Loads` and `Invoices` were empty for this tenant. That
judgement was correct for those two tables and **too broad as I first described it**: the
tenant is not a scratch workspace. `CrmAccounts` holds two records created 2026-08-07 and
updated 2026-08-10, so somebody is using it. Nothing outside `Loads` and `Invoices` was
written.

**Recommendation:** a separate set of tables for development, before any further live
testing. A prefix read from the environment is a small change to
`resource-registry.ts`/`loads-api-proxy.ts` and it removes this class of question
permanently.

---

## Status — what has been fixed

`npm run verify` is green: `tsc --noEmit` clean, 628 tests passing, tenant guard clean.
Also passes shuffled and repeated. Note that vitest 4 has **no** `--shuffle` or
`--repeat-each` CLI flag — they are config options, and passing them on the command
line fails with `CACError: Unknown option`, which is easy to mistake for a pass if
the output is filtered. Verify with `sequence: { shuffle: true }, repeats: 2` in
`vitest.config.ts`.

A two-role broker/driver simulation runs the real handlers against a JSON store —
`bash sim.local/act.sh <actor> <cmd> [loadId] [json]`, gitignored via `*.local`. It
substitutes only DynamoDB and JWT parsing; every guard still applies. It found B12,
B13, B14, B15 and B16 below — and B16 is a hole in the fix for B14, which is the
argument for running the thing rather than only writing tests against it.

| # | Finding | Status | Where the fix lives |
|---|---|---|---|
| **AUTHZ** | Any authenticated tenant user could rewrite any load's rates, undetectably | **fixed** | [tenant/load-permissions.ts](src/lib/tenant/load-permissions.ts) — three separate gates: write / price / delete |
| B1 | `applyDriverAction` accepted any action from any state | **fixed** | [session-local.ts](src/lib/tracking-workflow/session-local.ts) `canApplyDriverAction` |
| B2 | `PATCH` accepted any `loadStatus`, any transition, any invented value | **fixed** | [load-status.ts](src/lib/load-status.ts) + [loads-api-proxy.ts](src/lib/loads-api-proxy.ts) → 409 `illegal_transition`, 400 `unknown_status` |
| B3 | Rates writable after delivery and after the invoice was sent | **fixed** | `LOAD_POST_DELIVERY_FROZEN_FIELDS` → 409 `load_economically_frozen` |
| B4 | Invoice ids collided; the colliding write silently won | **fixed** | `createInvoiceId` is now deterministic per load |
| B5 | A load with no `customerRate` billed the **carrier's** rate to the customer | **fixed** | `buildDraftLinesFromLoad` — `carrierRate` removed from the chain |
| B6 | `parseMoney` zeroed unparseable amounts and inverted `(500)` | **fixed** | `parseMoneyStrict` returns `null`; credits become explicit `credit` lines |
| B8 | The device clock ordered the event stream | **fixed** | `serverAt` stamped in [driver-loads-proxy.ts](src/lib/driver-loads-proxy.ts); `latestDriverStatus` orders by it |
| B9 | Tracking board never wrote `loadStatus` → loads missed the billing queue | **fixed** | `loadStatusForCloudWrite` |
| B10 | `Quotes` wrote a capitalised `"Booked"` | **fixed** | normalised at the API boundary, and at the source |
| B11 | No one-invoice-per-load constraint → double billing on a double-click | **fixed** | deterministic id makes the partition key enforce it |
| G24 | `sent` was a status, not a lock | **fixed** | `isInvoiceLocked`, `updateInvoiceDraft`, `reviseInvoice` |
| G33 | No optimistic concurrency — concurrent patches interleaved | **fixed** | `UpdateOptions.expect` in [tenant-repository.ts](src/lib/server/tenant-repository.ts) → 409 `STALE_RECORD` |
| G35 | `cancelled` was terminal to readers but unreachable from any UI | **fixed** | canonical in `LOAD_STATUSES`, reachable pre-`loaded` |
| Q1 | "Assigned loads still show Awaiting Driver" — the [`TODO`](TODO) | **fixed** | new `driver-assigned` tracking state at rank 0.5 |
| Q6 | A driver could `PATCH` `loadStatus` to `completed` / `cancelled` | **fixed** | `DRIVER_WRITABLE_LOAD_STATUSES` → 403 `status_not_writable` |
| G11 | `accuracyM` was stored and never read | **partly** | `isGpsAccurateEnoughForDecisions` added; nothing calls it yet because arrival is still simulated (G9) |
| B7 | Money is float dollars, not integer minor units | **open** | deliberately not attempted — see below |
| Q3 | Is `customerTrackingLink` served? | **answered** | placeholder, not served, no route. Now a precondition on G30, not a live leak |

### Found during the live broker/driver run

All of these came out of a driver working an actual load in a two-role simulation
against the real handlers. They are the kind that only surface when someone uses the
thing: two of them (B15, B16) are holes in fixes I had already written tests for and
believed were done.

| # | Finding | Status |
|---|---|---|
| **B12** | **The driver API leaked the brokerage's margin.** Writes were locked but `GET /api/driver/loads` returned the whole DynamoDB item, so a driver's phone received `customerRate` next to `carrierRate` — on the *list* endpoint, before opening a load. A driver refused permission to *edit* `carrierRate` could still read the number needed to negotiate against it. Fixed with `DRIVER_READABLE_FIELDS`, an allowlist: `customerRate` and `linehaulRate` stripped, `carrierRate` kept (it is their pay). Allowlist, not denylist, so the next economic column does not leak by default. | **fixed** |
| **B13** | **The driver `loadStatus` allowlist compared raw strings, so it refused aliases of values it allowed.** `in-transit` passed; `en-route-delivery` — the same status, other spelling — returned 403. A driver tapping "departing shipper" got a permission error on a status they were entitled to set. The fix is one call to `normalizeLoadStatus` before the comparison, which is the entire reason that function exists; not calling it was the bug. `dispatched` was also missing from the set. | **fixed** |
| **B14** | **`driverStatusHistory` was entirely client-supplied — so a client that never sent it left no audit trail at all.** A seven-step run from such a client produced a delivered load with no record of when the driver reached the shipper, departed, or delivered. That is the field a late-delivery dispute and every detention claim are argued from. The server now appends the entry itself on each status report, attributed to the token subject with its own timestamp, via `list_append` so a phone returning from a dead zone cannot overwrite the trail. | **fixed** |
| **B15** | **The post-delivery freeze was keyed on `loadStatus` alone, so it did not engage on loads the driver delivered.** A driver records delivery in `driverWorkflowStatus`; `loadStatus` only follows if something else writes it. In the live run the load finished with `driverWorkflowStatus: delivered` and a POD on file while `loadStatus` still read `driver-assigned` — and the broker changed the customer rate to $9,999 and rewrote the BOL number, both HTTP 200. My own B3 fix, defeated by trusting one of two fields that record the same fact. `isLoadDelivered` now reads both, and the 409 message names whichever one establishes delivery. | **fixed** |
| **B16** | **The first audit-trail fix was forgeable and destructive — B14's fix was itself the bug.** It accepted a client-supplied `driverStatusHistory` and only filled in a missing `serverAt`. So: supply your own `serverAt` and it was trusted verbatim; supply your own `by` and it was never checked against the token; and because the update *assigned* the array rather than appending, one request replaced the whole trail. A driver turned four recorded stops into a single entry dated 2020, attributed to a different driver, `source: "forged"` — HTTP 200. Strictly worse than no history, because dispatch would have trusted it: a driver could move their own arrival times to defeat a detention claim, pin a late delivery on someone else, and erase the evidence in the same call. The field is now server-owned (`SERVER_OWNED_DRIVER_FIELDS`), refused with 403 rather than silently stripped, and the append is unconditional. The driver portal no longer sends it. | **fixed** |
| **G38** | **A POD's reference is not checked against the load's own BOL.** A driver filed `pod:BOL-556731-signed.jpg` on a load whose `deliveryReference` was `BOL-999999` and nothing objected. That is the ordinary way a POD gets kicked back and payment sits another 30 days. Should refuse, or flag for a human. | **open** |
| **G39** | **A driver has no way to report a reference-number discrepancy.** Refusing their `deliveryReference` write is correct — it is the key the invoice reconciles on — but they are the only person holding the physical BOL, so the refusal needs a companion: a note or exception field they *can* write, so a mismatch reaches a human instead of a phone call that never happens. | **open** |
| **STRUCTURAL** | **`loadStatus` and `driverWorkflowStatus` recorded one fact in two fields and nothing kept them in step.** This single split caused B9, B15, and the desync a driver hit twice — and patching each *reader* to consult both fields is what caused those bugs, because it only takes one new guard reading one field to reopen the hole. Fixed at the write boundary instead: `loadStatusForDriverWorkflow` moves `loadStatus` with the driver's step, forward-only and only where the lifecycle table permits, so no reader can observe them disagreeing. A seven-step run sending *only* `driverWorkflowStatus` now walks `loadStatus` `driver-assigned → dispatched → at-pickup → loaded → in-transit → at-delivery → delivered`. | **fixed** |
| **G32** | **No audit trail on load mutations.** Role checks stopped a disallowed rate change and left no trace of an allowed one, so after the fact you could say "that cannot have happened" but never "here is what happened". `loadAuditTrail` is now server-built from the verified token, appended in the same statement as the write, refused with 403 if a request supplies it, and carries before/after values for economic fields only (names-only elsewhere, to stay clear of the 400KB item limit). A no-op resend logs nothing, so whole-record editor saves do not bury the one change that mattered. | **fixed** |
| **G37** | **Nothing measured a status report against its appointment window.** Recorded, never refused — a driver outside their window is Tuesday, and rejecting the report would lose the event and leave the board showing a truck that never arrived. Each dock event now carries `onTime` and `varianceMinutes`; steps with no appointment carry neither, and a load with no window carries neither rather than a misleading "on time". Verified against the case that prompted it: +257m late at pickup, −2263m at delivery. `detentionClockStart` implements the Q4 rule (free time starts at the later of arrival and window open). | **fixed** |
| **G38** | **A POD's reference was not checked against the load's own BOL.** Now refused with 409 `document_reference_mismatch`, naming the expected reference. Deliberately narrow: it fires only when a filename carries a recognisably reference-shaped token matching *none* on the load. `signed-pod.jpg` is accepted, and `loadId` is excluded from the comparison — treating our internal handle as a BOL would refuse legitimate paperwork on any load whose references were never filled in, blocking the payment this protects. | **fixed** |
| **G39** | **A driver had no way to report a discrepancy they were not allowed to fix.** `reportIssue` is a driver-writable *input* the server converts into an attributed entry on the server-owned `driverExceptions` trail. The driver supplies the text; the server supplies who and when. `driverExceptions` itself is refused, same posture as the status trail. | **fixed** |
| **G33+** | Optimistic concurrency extended: `UpdateOptions.append` performs `list_append` inside the update expression, so an append-only trail genuinely appends — two concurrent writers both land, and no caller can shorten the list by sending a shorter one. | **fixed** |
| **B17** | **The driver write path 404'd a load that had just been assigned.** Only a live run against real DynamoDB showed it. My pre-write read went through `assignedDriver-index` — a **GSI, and therefore eventually consistent** — so for a window after dispatch assigns a load the index does not carry it and the driver's accept returned `404 Load not found` on a load genuinely theirs. This was a regression I introduced: the previous code went straight to the conditional `UpdateCommand`, which reads the strongly-consistent base table. Now a `GetCommand` on the base table with `ConsistentRead`, verifying `assignedDriver` in code. No weakening — the boundary is still the `ConditionExpression` on the write, and a load belonging to someone else still 404s. | **fixed** |
| **B18** | **A duplicate create surfaced as an opaque 502.** `attribute_not_exists` always stopped the duplicate, but the resulting `ConditionalCheckFailedException` fell through to the generic handler, so a double-clicked "create invoice" read as a server outage and a client had no way to tell a retryable fault from a settled duplicate. Now `RecordAlreadyExistsError` → 409 `already_exists`, mapped in both the loads and resource proxies. | **fixed** |
| **B19** | **A stale index entry served a reassigned load to the previous driver.** I first filed this as G40, an availability nit — "a freshly assigned load is briefly invisible". That was the harmless half. A GSI is stale in *both* directions, and the other one leaks: a load reassigned from driver A to driver B keeps its old `assignedDriver = A` entry for a moment, so A's list kept serving it — facility addresses, receiver contact, carrier rate. Authorization staleness on a read path, in the module whose whole job is scoping driver reads. The index is now a *candidate list* and the base table decides, with `ConsistentRead`. The detail endpoint reads the base table by primary key instead of a Query+Filter over the driver's whole partition — cheaper and correct in both directions. Verified live: reassign, and the load is gone from the list and 404s on detail at +0ms. | **fixed** |
| **B20** | **My own fix for B19 took the driver's entire load list down.** The first version confirmed candidates with `BatchGetItem`. The server principal's policy grants Query, GetItem, PutItem, UpdateItem and DeleteItem — **not** `dynamodb:BatchGetItem` — so every `GET /api/driver/loads` became a 502 the moment it shipped. Unit tests could not catch it: they mock the DynamoDB client, so IAM is invisible to them. Worse, my own live probe reported it as ">15000ms propagation lag" because it inferred "not visible" from an absent field instead of asserting the status — a 502 read as slowness. Fixed by confirming with individual `GetItem`s, an action the principal is already known to hold because the detail endpoint has always used it. Adding the IAM permission was the obvious fix and the wrong one: a correctness change that depends on an out-of-band policy deploy is broken in every environment where that deploy has not happened, failing exactly the way this did — silently, at the endpoint a driver opens first. | **fixed** |
| **G40** | **A load assigned moments ago is briefly absent from the driver's list.** The surviving direction, and it cannot be closed here: DynamoDB has no strongly-consistent read of a non-key attribute, so removing it means a different access pattern — an assignment list kept on the driver, written transactionally with the load. That is a schema change with its own drift risk. Measured on real infrastructure: **368–773ms** across three rounds, and the portal polls, so a driver sees it on the next tick. Writes are unaffected — `getAssignedConsistent` reads the base table, so a driver can act on a load the instant it is theirs even if the list has not caught up. | **open, measured** |
| **G36** | **No carrier pay breakdown.** `fuelSurcharge` is the *customer's* billable fuel line; there is no carrier-side FSC, no accessorial split, nothing a driver can check a settlement against. The driver in the run sized the load at linehaul + FSC and was wrong about his own pay by $415.50. No live harm today — the portal only ever displays `carrierRate` — but the driver app cannot honestly show all-in pay until the model separates buy-side from sell-side. | **open** |
| **G37** | **Nothing validates a status change against the appointment window.** The driver marked `at-pickup` a day before the pickup window opened and `delivered` two days before the delivery appointment; both were accepted silently. On-time percentage, detention, and late-fee claims are all computed off these timestamps. Related to G18 but distinct: G18 is feasibility *between* stops at build time, this is actual-versus-scheduled at report time. | **open** |

### Deliberately not attempted

- **B7 (integer minor units).** This is a data migration over every persisted
  `InvoiceRecord`, not a refactor. Doing it in the same pass as the guards would mean one
  change nobody can review. The reconciliation invariant `total === Σ lines` is now
  locked down by test, which is what makes the migration safe to do next.
- **The feature-shaped gaps** — offer expiry and the tender waterfall (G3), idempotency
  keys (G4), the offline queue (G8), real geofencing (G9), a ping stream (G10), detention
  (G13), OS&D (G16), multi-stop (G17), the PDF (G29), a `client` role (G30), payment
  webhooks (G23). These are things to build, not bugs to fix, and each needs a product
  decision first.
- **G32 (an audit trail for load mutations).** The single highest-value remaining item,
  because it is what makes the AUTHZ fix verifiable after the fact rather than merely
  enforced. Recommend it next.
- **B4's historical audit.** The conditional write stops new collisions; it says nothing
  about invoices already lost. Note that a *collision* left one row where two should be,
  so it is unfindable — the query worth running is `GROUP BY loadId HAVING count > 1`,
  which finds the B11 double-billing case instead. One-off script under `scripts/`, not a
  repository method: `tenant-repository` has no `Scan` on purpose.

---

## Bugs

### B1 — `applyDriverAction` accepts any action from any state
[session-local.ts:1146-1286](src/lib/tracking-workflow/session-local.ts#L1146-L1286)

`getNextDriverActions` computes the legal action set; `applyDriverAction` never calls it.
Its only rejection is a missing session. 120 of 130 state×action cells apply, and 55 walk
the load backwards in rank. A dispatcher can put a `completed` load back to
`driver-accepted` from the Driver Actions row.

Blast radius is limited by three things — `routeProgressPct` is monotonic, the persisted
`driverWorkflowStatus` is protected by `driverWorkflowForCloudWrite`'s non-regression
check, and `syncTrackingSessionsForLoads` re-derives on the next genuine load write. But
`trackingSession.trackingState` *is* persisted, so the corrupt state survives a reload,
and the progress bar contradicts the label in the meantime.

**Fix:** guard `applyDriverAction` with `getNextDriverActions(current.trackingState)`;
return a typed rejection rather than `null`, so the caller can distinguish "no session"
from "illegal transition". Keep `decline-load` reachable from anywhere — that is
`reportTrackingException`'s only mechanism ([:1288](src/lib/tracking-workflow/session-local.ts#L1288)).

**Severity:** high. Data corruption, visible to customers on the tracking link.

---

### B2 — `PATCH /api/loads/:id` accepts any `loadStatus`, from any status, at any time
[loads-api-proxy.ts:134-145](src/lib/loads-api-proxy.ts#L134-L145)

The handler validates body shape, size and server-owned fields. It never reads
`loadStatus`. `draft → delivered`, `delivered → draft`, and
`loadStatus: "totally-invented"` all return `200`. `loadStatus` is typed `string`
([loads-store.ts:20](src/lib/loads-store.ts#L20)) with no union, so nothing upstream
constrains it either.

This is the same class as B1 but at the boundary that actually matters — it is reachable
with `curl` and a valid token, and per §2's ground rule it is the only control that
counts.

**Fix:** a `LoadStatus` union type, a server-side transition table, and a `409` with a
machine-readable code on an illegal move. That is the missing state machine, not a patch.

**Severity:** high.

---

### B3 — rate fields stay writable after delivery and after the invoice is sent
[loads-api-proxy.ts:134](src/lib/loads-api-proxy.ts#L134), [loads-store.ts:69-78](src/lib/loads-store.ts#L69-L78)

`customerRate`, `linehaulRate`, `fuelSurcharge`, `accessorialCharges` and the rest are
ordinary mutable attributes on `LoadRecord`. `PATCH` accepts them at `delivered`, at
`completed`, and after the corresponding invoice has moved to `sent`. No versioning, no
audit row, no revision.

An already-persisted `InvoiceRecord` is a snapshot and does not silently change — that
part is safe. What does change is what a *re-drafted* invoice says, with no link back to
the version that was actually billed. This is bug 4 from the prompt's §0, live.

**Fix:** freeze the economic fields once `loadStatus` reaches `delivered`; corrections go
through a versioned revision that the invoice references by version.

**Severity:** high.

---

### B4 — invoice ids collide, and the colliding write wins silently
[accounting-store.ts:329-334](src/lib/accounting-store.ts#L329-L334)

```js
`${cleanPrefix}${loadId}-${Date.now().toString(36).toUpperCase().slice(-5)}`
```

Two invoices drafted for the same load inside the same base-36 tick share an id.
`putInvoice` goes through the resource registry's `PUT`, which is a `PutCommand`
**without** `attribute_not_exists` — `createTenantRepository.create` has the guard
([tenant-repository.ts:187](src/lib/server/tenant-repository.ts#L187)) but the update path
does not, so the second invoice overwrites the first rather than failing.

Numbering is also not sequential and not per-tenant-contiguous, so §7's "50 parallel
creates yield exactly the expected contiguous range" cannot pass. The achievable
assertion is "50 parallel creates yield 50 distinct persisted invoices" — and that fails
too.

**Fix:** a per-tenant counter (Dynamo atomic `ADD` on a `Counters` item) and
`attribute_not_exists(invoiceId)` on create.

**Severity:** high. An overwritten invoice is lost revenue with no trace.

---

### B5 — a load with no `customerRate` bills the carrier's rate to the customer
[accounting-store.ts:262-263](src/lib/accounting-store.ts#L262-L263)

```js
const linehaul = parseMoney(load.customerRate) || parseMoney(load.linehaulRate) || parseMoney(load.carrierRate);
```

The fallback chain ends at `carrierRate`. On a brokered load where dispatch filled in the
carrier's buy rate but not the customer's sell rate, the customer is invoiced the buy
rate — the brokerage's entire margin, given away, on an invoice that looks perfectly
normal. The `||` chain also treats a legitimate `"0"` as absent and falls through.

**Fix:** drop `carrierRate` from the chain. A missing `customerRate` must block invoice
generation, not silently substitute.

**Severity:** high. Direct revenue loss, invisible.

---

### B6 — `parseMoney` turns unparseable and negative money into zero or the wrong sign
[accounting-store.ts:131-135](src/lib/accounting-store.ts#L131-L135)

```js
const n = Number(String(value).replace(/[^0-9.-]/g, ""));
return Number.isFinite(n) ? n : 0;
```

- `"$1.2.3"` → `NaN` → **`0`**. A typo'd rate silently bills nothing.
- `"(500)"` (accounting negative) → `"500"` → **`+500`**, sign inverted.
- `"1-2"` → `NaN` → `0`.
- `"1,847.30"` → `1847.3` ✅ — the common case is fine, which is why this survives.

Then `buildDraftLinesFromLoad` gates every non-linehaul line on `if (x > 0)`
([:279-311](src/lib/accounting-store.ts#L279-L311)), so a negative accessorial or any
credit is dropped from the invoice entirely — no line, no warning. §3 of the prompt asks
that a negative accessorial without an explicit credit type fail loudly; today it
disappears.

**Fix:** parse strictly, return `null` on failure, and make the caller decide. Represent
credits as an explicit line kind rather than a negative amount.

**Severity:** medium-high.

---

### B7 — money is float dollars, stored as floats, and displayed without cents
[accounting-store.ts:38](src/lib/accounting-store.ts#L38), [:137-139](src/lib/accounting-store.ts#L137-L139), [:642-648](src/lib/accounting-store.ts#L642-L648)

`InvoiceLineItem.amount` and `InvoiceRecord.{subtotal,tax,total}` are `number`,
`moneyRound(n) = Math.round(n * 100) / 100` is applied per line *and* again to the
subtotal, and `money()` formats with `maximumFractionDigits: 0`.

Double rounding on a `.005` boundary drifts, and because the default formatter hides
cents, a one-cent drift is invisible in the UI — exactly the AP-batch-rejection bug from
the prompt's §0. `Number.isInteger` is false for effectively every stored money value, so
§10's "all money assertions in integer minor units" cannot be satisfied without a
migration.

**Fix:** integer minor units end to end (`amountCents: number`), round once at the
boundary, format from the integer. This is a data migration, not a refactor — flagging it
as the largest single piece of work implied by §7.

**Severity:** medium now, high on the first non-USD or high-volume-AP customer.

---

### B8 — the device clock orders the event stream
`driverStatusHistory[].at`, `driverGps.lastPingAt` and every timeline `timestamp` are
stamped client-side with `new Date().toISOString()`
([driver loads-store.tsx:345](apps/driver-portal/src/lib/loads-store.tsx#L345),
[session-local.ts:1156](src/lib/tracking-workflow/session-local.ts#L1156)), and the
timeline merge sorts on that string
([:1123](src/lib/tracking-workflow/session-local.ts#L1123)). There is no
`deviceReportedAt` / server-timestamp split.

A phone three hours off does not merely mislabel events — it reorders them, and the
`driverStatusHistory` fallback in `deriveTrackingStateFromLoad`
([:666-676](src/lib/tracking-workflow/session-local.ts#L666-L676)) reads
"last entry in array order", so a backdated append can be treated as the latest status.

**Fix:** server-stamp an `occurredAt` on write, retain the client value as
`deviceReportedAt`, order by the server value. §5 of the prompt specifies exactly this.

**Severity:** medium.

---

### B9 — a dispatcher advancing a load on the tracking board never updates `loadStatus`
[session-local.ts:180](src/lib/tracking-workflow/session-local.ts#L180)

`writeSessionToLoad` patches exactly `{ trackingSession, driverWorkflowStatus }`.
`loadStatus` is never written from the tracking board. So a load walked to `delivered`
there keeps whatever `loadStatus` it had, and `isLoadBillable` reads `loadStatus`
([accounting-store.ts:242-252](src/lib/accounting-store.ts#L242-L252)).

It is saved today only by the `|| driverWorkflowStatus === "delivered"` fallback on the
last line of that check — a single `||` standing between the tracking board and loads that
never appear in the billing queue.

**Fix:** write `loadStatus` alongside, from an explicit `TrackingState → loadStatus` map,
with the same non-regression discipline `driverWorkflowForCloudWrite` already applies.

**Severity:** medium. Load quietly ineligible for invoicing.

---

### B10 — `Quotes` writes a capitalised `loadStatus`
[quotes.tsx:500](src/routes/quotes.tsx#L500)

`loadStatus: "Booked"`, where every other writer uses lowercase. All current readers
lowercase before comparing, so it works — by luck, not by design. The first reader written
without `.toLowerCase()` breaks on quote-originated loads only.

**Fix:** a `LoadStatus` union (also the fix for B2) makes this a compile error.

**Severity:** low, sharp edge.

---

## Gaps — the prompt asks for a test whose subject does not exist

Not defects. Each is a feature the suite cannot cover because there is nothing to call.
Listed with the prompt section that requires it, so the traceability doc can name the gap
rather than quietly skip the row.

| # | Prompt § | Missing subject | Evidence |
|---|---|---|---|
| G1 | §1, §4 | **Transition-verb endpoints.** No `/accept`, `/tender`, `/dispatch`, `/deliver`, `/invoice`. Generic CRUD only. | [loads-api-proxy.ts:107-155](src/lib/loads-api-proxy.ts#L107-L155) |
| G2 | §1, §4 | **`409` anywhere.** No handler in `src/lib` emits one. | grep |
| G3 | §4 | **Offer / tender records.** `tendered` is a `loadStatus` string. No offer entity, no `expiresAt`, no expiry job, no waterfall, no next-carrier notification. | [create-load-constants.ts:89-94](src/components/loads/create-load/create-load-constants.ts#L89-L94) |
| G4 | §3, §4, §7, §8 | **Idempotency keys.** Nothing reads an `Idempotency-Key` header. | grep |
| G5 | §4 | **Carrier-assignment rows.** Assignment is the scalar `assignedCarrier` / `assignedDriver`. "Exactly one assignment row" is vacuous and cannot detect a double-accept. | [loads-store.ts:80-81](src/lib/loads-store.ts#L80-L81) |
| G6 | §4 | **Compliance gates at accept.** `isInsuranceExpired` exists but gates carrier *award* only ([carriers-store.ts:148-152](src/lib/carriers-store.ts#L148-L152)); the accept path never calls it. No CDL expiry, no carrier-active check. | [driver loads-store.tsx:336-379](apps/driver-portal/src/lib/loads-store.tsx#L336-L379) |
| G7 | §4 | **Overlapping-assignment detection.** No time-window conflict check anywhere. | grep |
| G8 | §5 | **Offline mutation queue.** No `navigator.onLine`, no IndexedDB, no retry, no backoff, no dead-letter. All three driver mutations `await` and toast on failure. | [driver loads-store.tsx](apps/driver-portal/src/lib/loads-store.tsx) |
| G9 | §5 | **Real geofencing.** "Geofence" events fire on simulated `routeProgressPct >= 20 / >= 90`. No radius, no distance calc, no dwell, no debounce. | [session-local.ts:342-368](src/lib/tracking-workflow/session-local.ts#L342-L368) |
| G10 | §5 | **A ping stream.** `driverGps` is one overwritten object, not a series. No replay, no ordering, no dedup by `(loadId, deviceReportedAt)`. Shares throttled to 1 / 10 min. | [driver-gps.ts:3-15](src/lib/driver-gps.ts#L3-L15) |
| G11 | §5 | **GPS-accuracy filtering.** `accuracyM` is stored and never read. Arrival is driven by simulated progress, not position, so "low accuracy cannot trigger arrival" is not expressible. | [driver-gps.ts:6](src/lib/driver-gps.ts#L6) |
| G12 | §5 | **Stale-location detection.** `isDriverGpsFresh` picks live-vs-simulated GPS; no stale flag, no alert, no clear-on-next-ping. | [driver-gps.ts:20-31](src/lib/driver-gps.ts#L20-L31) |
| G13 | §6 | **Detention calculation.** `detentionRate` is a manually-entered string field. No arrival/departure math, no free-time rule, no DST or midnight handling, no dollars. | [loads-store.ts:75](src/lib/loads-store.ts#L75) |
| G14 | §6 | **POD validation.** No zero-byte check, no corrupt-file check, no pre-upload size rejection. Only a 350KB *warning* against the Dynamo item limit. | [loads-store.ts:106-122](src/lib/loads-store.ts#L106-L122) |
| G15 | §6 | **Signature capture.** No name/timestamp/geolocation triple, no immutability. | grep |
| G16 | §6 | **OS&D.** No overage/shortage/damage record, no quantity, no invoice hold. | grep |
| G17 | §6, §3 | **Multi-stop loads.** `LoadRecord` has exactly two hardcoded stops (`pickup*` / `delivery*` field prefixes). No stop rows, no sequence, no renumbering, no orphans. §3's 5-stop and §6's partial-delivery tests have no subject. | [loads-store.ts:28-55](src/lib/loads-store.ts#L28-L55) |
| G18 | §3 | **Drive-time feasibility between appointment windows.** No check. A 400-mile hop in a 30-minute window is accepted. | grep |
| G19 | §3 | **Weight canonicalisation.** `weight` is a `string` with a sibling `weightUnit: "lbs" \| "kg"`. No canonical storage, no integer pounds, no equipment-limit check, and no API-boundary guard against a lbs/kg mismatch. | [loads-store.ts:58-59](src/lib/loads-store.ts#L58-L59) |
| G20 | §3 | **Duplicate PO/BOL detection.** `pickupReference` / `deliveryReference` are free strings with no uniqueness constraint, per-tenant or otherwise. | [loads-store.ts:41](src/lib/loads-store.ts#L41), [:55](src/lib/loads-store.ts#L55) |
| G21 | §3 | **Field-keyed all-errors-at-once validation.** Create validates only that `loadId` is a non-empty string. | [loads-api-proxy.ts:127-129](src/lib/loads-api-proxy.ts#L127-L129) |
| G22 | §3 | **Draft autosave idempotency.** Drafts live in `load-drafts-storage` (local); no upsert key, no server-side dedupe on rapid saves. | [load-drafts-storage.ts](src/lib/load-drafts-storage.ts) |
| G23 | §7, §8 | **A `PAID` state and payment webhooks.** `paidAt` is declared and never set. No AP/payment webhook handler exists. Replay-idempotency and out-of-order-webhook tests have no subject. | [accounting-store.ts:56](src/lib/accounting-store.ts#L56) |
| G24 | §7 | **Invoice lock on send.** `sent` is a status, not a lock. `upsertInvoice` accepts any mutation at any status. | [accounting-store.ts:521-523](src/lib/accounting-store.ts#L521-L523) |
| G25 | §7 | **Credit memos / revisions.** No credit entity, no revision link, no original-preserved guarantee. | grep |
| G26 | §7 | **Derived-vs-manual line attribution.** `InvoiceLineItem` has `{id, kind, label, amount}` and no `source`. A hand-typed line is indistinguishable from a carried-over one. | [accounting-store.ts:34-39](src/lib/accounting-store.ts#L34-L39) |
| G27 | §7 | **Currency / FX.** No `currency` field. `money`/`moneyExact` hardcode `en-US`/`USD`. No stored FX rate. | [accounting-store.ts:642-654](src/lib/accounting-store.ts#L642-L654) |
| G28 | §7 | **Tax.** Hardwired `moneyRound(subtotal * 0)` at draft; settable only via manual `edits.tax`. | [accounting-store.ts:314](src/lib/accounting-store.ts#L314) |
| G29 | §7 | **Invoice PDF.** No generator. §7's totals-match, masked snapshot, and every-line-item-present assertions have no artefact. | grep |
| G30 | §5, §7 | **A `client` / customer-portal role.** Ten roles exist; none is a customer. §5's and §7's "client sees no rate or margin data" has no principal to authenticate as. | [admin-user-constants.ts:24-35](src/lib/admin-user-constants.ts#L24-L35) |
| G31 | §4 | **Role authorization on load and invoice endpoints.** `requireCurrentTenantContext` is called; `ctx.role` is never read. Sales and Marketing can rewrite rates. | [loads-api-proxy.ts:101](src/lib/loads-api-proxy.ts#L101) |
| G32 | §1, §8 | **An audit trail for load changes.** `admin-audit-store` covers admin actions only. Load and invoice mutations write no audit row, so "audit row written" is unassertable on every transition. | [admin-audit-store.ts](src/lib/admin-audit-store.ts) |
| G33 | §5 | **Optimistic concurrency.** `update` has no version predicate — two concurrent `PATCH`es interleave per attribute, last write wins. Tenant and assignment predicates are present and correct; a *staleness* predicate is not. | [tenant-repository.ts:200-242](src/lib/server/tenant-repository.ts#L200-L242) |
| G34 | §2 | **Test tooling.** Only `vitest` is installed — no `playwright`, `msw`, `supertest`, `fast-check`, or coverage provider. `vitest.config.ts` collects `src/**` and `apps/*/src/**` only, so a `tests/` tree is not picked up. | [package.json](package.json), [vitest.config.ts](vitest.config.ts) |
| G35 | §1 | **A reachable cancelled state.** `cancelled` is treated as terminal by three readers but is absent from `LOAD_STATUS_OPTIONS` — no UI can produce it. | [create-load-constants.ts:75-108](src/components/loads/create-load/create-load-constants.ts#L75-L108) |

---

## Open questions — need a decision before a test can assert

### Q1 — Should a load assigned to a driver who has not answered read as "Waiting for Driver"?
This is the open item in [`TODO`](TODO). Today `waiting-driver` covers both "nobody
assigned" and "assigned, awaiting response", because `driver-assigned`, `active`, `booked`
and `tendered` are deliberately excluded from `TRACKING_STATE_BY_LOAD_STATUS`
([session-local.ts:527-532](src/lib/tracking-workflow/session-local.ts#L527-L532)). The
exclusion is correct — dispatch's act is not driver acceptance — but the label is wrong
for the assigned case, and the naming collision (`driverWorkflowStatus: "assigned"` means
*accepted*) makes it read as a bug.

**Recommendation:** add a distinct `driver-assigned` tracking state at rank 0.5, label
"Assigned · awaiting driver", derived from `assignedDriver` being set with no
`driverWorkflowStatus`. Rename the driver-portal `assigned` step to `accepted` in the same
change, since it is the actual source of the confusion. Cheap, and it closes the `TODO`.

### Q2 — Does an ops user get a distinct answer for "another tenant's load" vs "no such load"?
`get` returns `null` for both and the handler 404s both
([tenant-repository.ts:131-147](src/lib/server/tenant-repository.ts#L131-L147)) — correct
and deliberate, and the module comment says so. **Recommendation:** keep. Lock it in with
a test now, before someone "improves" the error message.

### Q3 — Is the customer tracking link authenticated?
`trackingSession.customerTrackingLink` exists
([types.ts:100](src/lib/tracking-workflow/types.ts#L100)) and `toTrackingSessionCloud`
strips only `messages`, `documents` and `viewUrl`
([session-local.ts:86-92](src/lib/tracking-workflow/session-local.ts#L86-L92)) — the
persisted session retains `customer` and `carrier`. I found no route that serves that
link, so I cannot tell whether it is a real unauthenticated endpoint or a placeholder
string.

**Recommendation:** answer this before building anything for G30. If the link is real and
unauthenticated it is the highest-severity finding in this document and belongs above B1.

### Q4 — When does detention free time start if the driver arrives before the appointment window opens?
§6 asks for an exact assertion and there is no rule in the code to check against.
**Recommendation:** free time starts at `max(arrival, windowStart)` — the shipper is not
liable for a driver who shows up two hours early. Needs confirmation; it is a commercial
term, not a technical one.

### Q5 — Does an open OS&D exception block invoicing or flag it?
No OS&D concept exists (G16). **Recommendation:** block, with an explicit
accounting-role override that writes an audit row. Blocking is recoverable; a wrong
invoice sent to a shipper's AP is not.

### Q6 — Should a driver be able to write `loadStatus` at all?
`DRIVER_WRITABLE_FIELDS` includes it, with the comment "Worth narrowing to reachable
statuses later" ([driver-loads-proxy.ts:44-53](src/lib/driver-loads-proxy.ts#L44-L53)).
Today a driver can `PATCH` any string, including `completed` or `cancelled`, which are
terminal to three readers.

**Recommendation:** narrow to the four values the portal actually writes —
`driver-assigned`, `active`, `delivered`, and whatever Q1 settles on. The field is needed;
the freedom is not.

### Q7 — What happens to a driver who declines after accepting?
`declineLoad` writes `driverWorkflowStatus: "declined"` unconditionally
([driver loads-store.tsx:400-403](apps/driver-portal/src/lib/loads-store.tsx#L400-L403)),
which derives to `exception`
([session-local.ts:658-660](src/lib/tracking-workflow/session-local.ts#L658-L660)) — from
any point, including mid-transit or after delivery. `assignedDriver` is left set, so the
load is neither the driver's nor available.

**Recommendation:** allow decline only from `waiting-driver` / `driver-accepted`. Past
that it is an exception report requiring a reason, and it should clear `assignedDriver` so
dispatch can reassign.

### Q8 — Is `exception` a state or an overlay?
Today it is a peer state at rank `-1`, so entering it discards the load's position and
`applyDerivedTrackingState` will not derive back out of it
([session-local.ts:691-693](src/lib/tracking-workflow/session-local.ts#L691-L693)) —
though `applyDriverAction` will (B1). §1 of the prompt assumes an overlay.

**Recommendation:** overlay. `{ trackingState, exception?: {...} }` keeps the position a
load has to return to after the exception clears. This is a modelling change, so it is a
decision, not a bug.

---

## Suggested order of work, revised

The prompt's order is right in shape but §7 has to move: "do not write phase 4 or 5 tests
before the money math is proven" is sound, and the money math is not currently provable
because it is float dollars over free-form strings (B7). Proposal:

1. Tooling — add `fast-check`, `msw`, `playwright`; widen the vitest glob (G34).
2. Factories + role fixtures for the eight real roles; no `client` (G30).
3. **Wire matrix** against `/api/loads` and `/api/driver/loads` — B2, B3, B10, plus the
   tenant-isolation assertions that pass. Committed with the failures.
4. **Money property tests** — B4, B5, B6, B7. The `total === Σ lines` invariant holds and
   is worth locking in first; the rest are the bugs.
5. Derive-precedence + `applyDriverAction` reducer matrix — B1, B8, B9.
6. E2E: the two journeys that exist today — driver accept on mobile, and the decline
   rollback from §4, which is the one optimistic-update path already implemented.

Steps 1–2 are inert. Step 3 is where the first real finding lands, which argues for doing
it before the money work despite §10's ordering — the wire matrix is cheap and it is the
control that §2 says is the only one that counts.
