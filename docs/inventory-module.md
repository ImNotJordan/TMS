# Inventory module

Warehouse stock for the ops console: a SKU catalogue, an append-only movement
ledger, and a per-warehouse rollup derived from the SKUs.

Route: `/inventory` · Module name: `Inventory` · API: `/api/inventory/*`

---

## 1. What it is

Two DynamoDB tables behind one server handler.

| Table                | Partition key | Holds                                                     |
| -------------------- | ------------- | --------------------------------------------------------- |
| `InventoryItems`     | `itemId`      | The SKU catalogue plus its current stock levels           |
| `InventoryMovements` | `movementId`  | Every receipt, shipment, allocation, adjustment and count |

Both are tenant-scoped exactly like every other table in the API tier: the
`companyId` comes from the verified Cognito ID token, listing goes through a
`companyId-index` GSI, and a cross-tenant miss answers 404 rather than 403.

### Stock is ledger-owned

`quantityOnHand` and `quantityAllocated` are not writable. `POST`/`PATCH` on an
item refuse them with `403 ledger_owned_field`, and the only path that changes
them is `POST /api/inventory/movements`, which computes the new levels from the
old ones.

This is the reason inventory is a hand-written handler rather than two more rows
in `src/lib/api/resource-registry.ts`. That registry's contract is "whatever the
caller sends, we store" — right for a quote, fatal for stock, because
`PATCH {"quantityOnHand": 5000}` would move five thousand units with no ledger
row, no reason and no attribution. The ledger would still reconcile against
itself while disagreeing with reality, which is worse than having no ledger at
all: a report drawn from it looks trustworthy.

There is no "opening quantity" field either. Seeding a new SKU posts a `receipt`
labelled *Opening balance*, so day one has a ledger row like every day after it.

### Movement kinds

| Kind         | On hand    | Allocated       | Who may post it                       |
| ------------ | ---------- | --------------- | ------------------------------------- |
| `receipt`    | `+qty`     | —               | Owner, Admin, SuperAdmin, Ops, Dispatch |
| `shipment`   | `-qty`     | `-min(qty,all)` | Owner, Admin, SuperAdmin, Ops, Dispatch |
| `allocate`   | —          | `+qty`          | Owner, Admin, SuperAdmin, Ops, Dispatch |
| `release`    | —          | `-qty`          | Owner, Admin, SuperAdmin, Ops, Dispatch |
| `adjustment` | `+/-qty`   | —               | Owner, Admin, SuperAdmin, Ops          |
| `count`      | `= counted`| —               | Owner, Admin, SuperAdmin, Ops          |

Adjustments and counts are deliberately one role narrower. An adjustment is a
write-off with no counterparty; a dispatcher who can post one silently can cover
a shipping error by writing the units off instead of reporting them short.

Three invariants hold on every path, enforced in `applyMovement`
(`src/lib/inventory-domain.ts`):

1. `quantityOnHand >= 0`
2. `quantityAllocated >= 0`
3. `quantityAllocated <= quantityOnHand`

The UI previews a movement with the same function the server authorizes with, so
the preview cannot promise an outcome the API then refuses.

### Posting a movement is a two-phase write

`tenant-repository` exposes no multi-item transaction, so a movement is
sequenced rather than atomic:

1. read the item, scoped → 404 if it is not the caller's
2. `applyMovement` → 422 if it would break an invariant
3. write the ledger row as `pending`
4. update the item, **preconditioned on the exact quantities read in step 1**
   → on failure, mark the row `rejected` and answer 409
5. promote the row to `posted` with the resulting levels

The precondition in step 4 is what makes this safe under concurrency. Two
dispatchers shipping the same pallet do not interleave — the second one's
precondition no longer matches and it is refused. Read-check-write without it is
the classic oversell: both see 10 on hand, both ship 8, the table lands at 2.

A crash mid-sequence leaves a `pending` row, which the ledger view surfaces as
unsettled and the page banners at the top. That is the point of writing the row
first: the failure mode is a visible discrepancy rather than a missing one.

---

## 2. Provisioning

### 2.1 Create the tables

```bash
REGION=us-west-1   # must match TITAN_AWS_REGION

aws dynamodb create-table \
  --region "$REGION" \
  --table-name InventoryItems \
  --attribute-definitions \
      AttributeName=itemId,AttributeType=S \
      AttributeName=companyId,AttributeType=S \
  --key-schema AttributeName=itemId,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --global-secondary-indexes '[{
    "IndexName": "companyId-index",
    "KeySchema": [{"AttributeName":"companyId","KeyType":"HASH"}],
    "Projection": {"ProjectionType":"ALL"}
  }]'

aws dynamodb create-table \
  --region "$REGION" \
  --table-name InventoryMovements \
  --attribute-definitions \
      AttributeName=movementId,AttributeType=S \
      AttributeName=companyId,AttributeType=S \
      AttributeName=createdAt,AttributeType=S \
  --key-schema AttributeName=movementId,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --global-secondary-indexes '[{
    "IndexName": "companyId-index",
    "KeySchema": [
      {"AttributeName":"companyId","KeyType":"HASH"},
      {"AttributeName":"createdAt","KeyType":"RANGE"}
    ],
    "Projection": {"ProjectionType":"ALL"}
  }]'
```

The movements index carries `createdAt` as a **sort key**. The repository issues
a partition-only key condition, so this changes nothing today — but it is what
makes "the last 200 movements" a bounded query later, instead of a migration.
The items index needs no sort key.

### 2.2 Grant the server principal

`InventoryItems` and `InventoryMovements` are already in `API_TABLES` in
`scripts/render-iam-policies.mjs`, so:

```bash
node scripts/render-iam-policies.mjs <ACCOUNT_ID> --write
# then reapply the rendered server policy in IAM
```

The browser never gets these tables. The client store talks to `/api/inventory`
and holds no DynamoDB credentials — the eslint tenant guard enforces that, and
`src/lib/inventory-proxy.ts` imports no AWS SDK at all: it goes through
`createTenantRepository`, which is the only module allowed to.

### 2.3 Point the app at them

Already added to `.env` (both default to the table name if unset):

```
VITE_INVENTORY_ITEMS_TABLE_NAME=InventoryItems
VITE_INVENTORY_MOVEMENTS_TABLE_NAME=InventoryMovements
```

### 2.4 Verify

```bash
node scripts/check-company-indexes.mjs   # both tables must report READY
npm run verify                           # tsc + vitest + tenant guard
```

Until the tables exist the API answers `503` with a code naming the problem
rather than a bare 502 — `storage_not_provisioned`, `index_not_ready`, or
`principal_not_permitted`.

---

## 3. Access control

Three layers, each answering a different question. All three run.

### Layer 1 — tenant

`requireCurrentTenantContext` → `createTenantRepository`. Answers *whose stock is
this*. Unchanged from every other resource.

### Layer 2 — module permissions, per user

`Inventory` is a first-class entry in `MODULES`, so **Admin → Role & Access →
Module Permissions** already has a row for it with the usual eight levels, for
every user and every permission template. Nothing bespoke to configure.

What is new: the matrix is now enforced **server-side** as well, in
`src/lib/tenant/module-access.ts`. Every `/api/inventory` request re-evaluates
the stored matrix with `canAccessModule` — the same evaluator the browser uses —
mapping `GET` to *view* and everything else to *mutate*.

That closes a real gap. `ModuleAccessGate` evaluates the matrix in the browser,
so before this, unchecking a box removed a sidebar entry and left the API
answering exactly as before; anyone who kept the URL was unaffected by the
admin's decision. Two details keep the server side sound:

- **Privilege comes from the token.** `canAccessModule` short-circuits for
  privileged roles and reads that role off the stored record with
  `normalizeRole`, which is fuzzy by design — `readonly-admin` normalizes to
  `Admin`. The stored role is replaced with the strict token role before
  evaluation, so a stored string cannot buy privilege.
- **It fails closed.** A permission lookup that cannot complete is a denial.

The matrix ride-alongs with the role lookup `requireCurrentTenantContext`
already performs and shares its 60-second cache, so this costs no extra read.
That TTL is also the propagation delay: an admin's change takes effect within
about a minute.

> The same enforcement is **not** yet applied to the eleven resources served by
> `api/resource-proxy`. Those still gate modules client-side only. Extending
> `checkModuleAccess` to that handler is a small change and a separate one.

### Layer 3 — role gates, per operation

`src/lib/tenant/inventory-permissions.ts`, keyed on the token's role and
therefore not widenable by editing a profile. Four separate decisions —
catalogue writes, valuation writes, movements, deletes — deliberately not
collapsed into one `canEditInventory(role)`, which is the shape where widening
one case silently widens the rest.

So granting a Marketing account `Inventory → Full Access` gets them the page and
still not the ability to write off a pallet. Conversely, an Operations Manager
with `Inventory → No Access` cannot reach it at all.

### Valuation is redacted, not hidden

`Can View Inventory Valuation` (a new `FIELD_PERMISSIONS` entry) and the
`INVENTORY_VALUERS` role set control `unitCost` / `unitPrice`. Either alone is
sufficient. When neither applies the server **strips both fields from the
response body** — a column the browser declines to render is still in the JSON,
one devtools panel away from the dispatcher who was not supposed to see the
margin.

`Can Post Inventory Adjustments` is also registered as a field permission for
admin visibility; adjustment authority is currently enforced by the role set
above.

### Deleting

Refused while the SKU holds any stock, even for an owner — deleting it would
drop units out of the valuation with no movement explaining where they went.
Archive instead; the movement history stays readable because every row carries a
denormalized `sku` and `itemName`.

---

## 4. Files

| File                                          | Role                                          |
| --------------------------------------------- | --------------------------------------------- |
| `src/lib/inventory-domain.ts`                 | Types, `applyMovement`, derivations. Pure.    |
| `src/lib/inventory-proxy.ts`                  | The server handler.                           |
| `src/lib/inventory-store.ts`                  | Client transport.                             |
| `src/lib/tenant/inventory-permissions.ts`     | Role gates.                                   |
| `src/lib/tenant/module-access.ts`             | Server-side module + field permission gate.   |
| `src/features/inventory/*`                    | The page.                                     |
| `src/routes/inventory.tsx`                    | Route.                                        |

Tests: `inventory-domain.test.ts` (41), `inventory-proxy.test.ts` (55),
`tenant/module-access.test.ts` (16).

---

## 5. Known limits

- **Ledger listing is unbounded.** `GET /api/inventory/movements` returns the
  company's whole ledger and filters client-side. Fine for months of activity,
  not for years. The `createdAt` sort key in 2.1 is what a `limit` + `before`
  parameter would use; nothing else has to change.
- **SKU uniqueness is best-effort.** Enforced by one indexed query on create and
  on rename, so a genuine race can duplicate a SKU. A composite
  `companyId#sku` partition key would make it atomic, at the cost of making a
  rename a delete-and-recreate and putting the tenant id in every URL. The trade
  was made the other way deliberately.
- **Warehouses are derived, not stored.** They come from the SKUs that sit in
  them. When a location needs its own attributes — dock doors, hours, a contact
  — promoting it to a table is a migration rather than a rewrite.
- **A movement is two writes, not one transaction.** Section 1 covers the
  failure modes; all of them are visible rather than silent.
