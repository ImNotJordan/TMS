# Company tenant model

How `companyId` works, how to turn it on, and what it does not yet protect.

---

## The model

Every user is assigned to exactly one company by an administrator. Every record
is stamped with that company on create, and every read is narrowed to it.

| Thing | Where it lives |
|---|---|
| A user's company | Profile table, `permissions` section: `companyId` + `companyName` |
| A record's company | `companyId` attribute on the item |
| The active company | [`src/lib/tenant/company-context.ts`](../../src/lib/tenant/company-context.ts) |
| Stamping and filtering | [`src/lib/dynamo-entity-store.ts`](../../src/lib/dynamo-entity-store.ts) |

This is the **lightweight** variant — no Companies table. The list of companies
is derived from the users assigned to them (`listKnownCompanies`), and the
display name is denormalized onto each user.

**The key is a generated UUID, never the typed name.** The name is a label you
can change; the id is what records are keyed by. Keying on the name would mean
"Acme Logistics" and "Acme Logistics LLC" become two silent tenants, and a
rename orphans every existing record.

### Why `companyId` is not user-editable

`companyId` is in `PRIVILEGED_PERMISSION_FIELDS`
([profile-store.ts](../../src/lib/profile-store.ts)), alongside `role` and
`adminAccess`. A user who could set their own company would be choosing whose
data they see. Profile → Company shows the assignment read-only; only the admin
create-user flow and `assignUserCompany` write it.

### Fail closed

A user with no company resolves to `null`, and every read returns nothing rather
than falling back to unfiltered. Records with no `companyId` — anything created
before this existed — are excluded from *every* company rather than matching all
of them. An empty dashboard is a support ticket; an unfiltered one is a breach.

That is why the bootstrap below is not optional: until it runs, existing data is
invisible.

---

## Turning it on

Run from a machine with AWS admin credentials. Not the browser's role.

### 1. See where you stand

```bash
node --env-file=.env scripts/assign-company.mjs --list
```

Lists every user, their role, and their company. Expect all `UNASSIGNED`.

### 2. Assign users to a company (dry run first)

```bash
node --env-file=.env scripts/assign-company.mjs \
  --all-unassigned --company-name "Your Company Name"
```

Review the output, then repeat with `--apply`. It prints the minted
`companyId` — **keep it, step 3 needs it.**

For a second company later, run again with `--user-id <sub>` per user, passing
`--company-id` to join an existing one or omitting it to mint a new one.

### 3. Backfill existing records (dry run first)

```bash
node --env-file=.env scripts/backfill-company-id.mjs --company-id <id-from-step-2>
```

Review, then re-run with `--apply`. It is idempotent and conditional on
`attribute_not_exists(companyId)`, so it will never reassign a row that already
has an owner, and a re-run is safe.

### 4. Sign out and back in

The company is resolved at sign-in. Anyone signed in during the change keeps a
null context until they re-authenticate.

### 5. Check

- Lists show your records again.
- Profile → Company shows the assigned company.
- Admin → Add User defaults to your company and offers it in the picker.

---

## Cognito setup

The tenant key lives on the Cognito user as `custom:companyId`, and lands in the
ID token automatically — **no pre-token-generation Lambda is needed**, because
Cognito includes readable custom attributes in the ID token and this app
authenticates with the ID token.

### Required attributes

| Attribute | Type | Mutable | Purpose |
|---|---|---|---|
| `custom:companyId` | String | **true** | Tenant key. Mutable so admins can reassign. |
| `custom:sessionEpoch` | String | **true** | Bumped on assignment; invalidates tokens issued earlier. |

`custom:sessionEpoch` is optional in the sense that assignment still works
without it — the endpoint retries and logs a warning. But **revocation is not in
force until it exists**: a reassigned user keeps their previous company until
their token expires.

### Console walkthrough (this project's values)

| | |
|---|---|
| Region | `us-west-1` |
| User pool | `us-west-1_1CZpzcipb` |
| App client | `79ge1ap862otob8hnc18q505ns` |

**Add `custom:sessionEpoch`:** Cognito → User pools → `us-west-1_1CZpzcipb` →
**Sign-up** tab → *Custom attributes* → **Add custom attributes** →
Name `sessionEpoch`, Type `String`, Min `0`, Max `2048`, **Mutable ✓**.

Cognito stores it as `custom:sessionEpoch`. Attribute names cannot be changed or
removed later, so check the spelling before saving.

### App client permissions — the setting that matters

Cognito → User pools → `us-west-1_1CZpzcipb` → **App clients** →
`79ge1ap862otob8hnc18q505ns` → *Attribute read and write permissions* → **Edit**.

You get a table of every attribute with **Read** and **Write** checkboxes. Set:

| Attribute | Read | Write |
|---|---|---|
| `custom:companyId` | ✓ | **unchecked** |
| `custom:sessionEpoch` | ✓ | **unchecked** |

**Change only those two rows.** The Profile page legitimately writes
`given_name`, `family_name`, `phone_number`, `custom:job_title`,
`custom:department` and friends through `updateUserAttributes`
([auth.tsx:222](../../src/lib/auth.tsx#L222)) — clearing Write across the board
breaks profile editing for everyone.

Why this and not attribute-level mutability: `Mutable: true` governs whether the
value can *ever* change, which admins need. The app client's **Write**
permission governs whether **the user's own token** can change it. If
`custom:companyId` is writable, a user assigns themselves any company, Cognito
signs the claim, and every check in the system faithfully enforces a value the
attacker chose.

Verify (optional, needs the AWS CLI):

```bash
aws cognito-idp describe-user-pool-client --region us-west-1 \
  --user-pool-id us-west-1_1CZpzcipb --client-id 79ge1ap862otob8hnc18q505ns \
  --query "UserPoolClient.{Read:ReadAttributes,Write:WriteAttributes}"
```

## Assigning a company

`POST /api/admin/company-assignment  { userId, companyId, companyName }`
([admin-company-proxy.ts](../../src/lib/admin-company-proxy.ts))

- **Admin role required**, verified server-side.
- Runs under the **server's IAM principal**, never the caller's Identity Pool
  credentials. That is what allows `cognito-idp:Admin*` to be removed from the
  browser role — moving the call while keeping the browser's credentials would
  achieve nothing.
- **Cross-tenant guard:** an admin may only assign to their own company, and may
  only move a user currently in it. A target in another company returns the same
  `404` as a nonexistent one, so the endpoint cannot be used to probe membership.
- Writes `custom:companyId` (authoritative) and bumps `custom:sessionEpoch`, then
  mirrors `companyId`/`companyName` into the Profile table for the directory. A
  mirror failure does not undo the assignment — Cognito is the source of truth.
- Returns `tokenRefreshRequired: true`.

### Platform operators — the one escape hatch

A company admin may only assign within their own company. A **platform
operator** may assign across companies, because onboarding a company means
assigning its first users before belonging to it.

That privilege comes from **Cognito group membership only** — `SuperAdmin` or
`platform-admin` in `cognito:groups` — never from `permissions.role` in the
Profile table. That row is writable by any browser holding Identity Pool
credentials, so keying platform privilege on it would let a user promote
themselves and then assign themselves into any company. Group membership can
only be changed with `cognito-idp:AdminAddUserToGroup`, which no browser holds.

Every cross-company assignment is logged as `[audit] platform admin acting
across companies` so the trail distinguishes it from ordinary administration.

**Setting it up:** Cognito → User pools → `us-west-1_1CZpzcipb` → **Groups** →
Create group → name it exactly `SuperAdmin` → then Users → your user → **Add to
group**. Sign out and back in; group membership only lands in a fresh token.

### The token-refresh gotcha

The assigned user's existing token still carries the old claim. Until they
re-authenticate they will keep the previous company, or get `403
COMPANY_ASSIGNMENT_REQUIRED` if they had none. **Test this explicitly.** Once
`custom:sessionEpoch` is in place the stale token is rejected outright rather
than silently continuing on old data.

## Adding users afterwards

Admin → Add User has a **Company** field on the first step. It:

- defaults to the admin's own company (the common case is adding a colleague);
- autocompletes from companies already in use;
- says whether the typed name **joins an existing company** (with its user count)
  or **creates a new one**, so a typo does not silently mint a second tenant;
- is required — creating a user with no company is refused, because that account
  would appear broken rather than unassigned.

---

## What this does not protect

Stated plainly, because the filtering reads like enforcement and is not.

**This partitions the UI, not the data.** The browser holds Cognito Identity Pool
credentials with direct DynamoDB access. Every filter here runs inside the
caller's own process. A user who opens devtools and issues a raw `Scan` still
reads every company's records, and a raw `PutItem` still writes them. The
`FilterExpression` on each scan keeps other tenants' rows off the wire and out of
the session cache during normal use — real reduction in exposure, not a boundary.

What it does buy, and the reason to do it now: **the data model is correct**.
Every record carries a stable tenant key from creation. When data access moves
behind the server API tier in Stage 1 and the browser's DynamoDB permissions are
revoked, `companyId` becomes a server-derived claim and these call sites do not
change. Doing this later means migrating twice.

### Known gaps

| Gap | Impact | Closes |
|---|---|---|
| Filtering is client-side | Any user can read/write all tenants via raw SDK calls | Stage 1 |
| Admin with no company sees all users | Fail-open bootstrap path in the directory | Stage 1 platform-admin role |
| No UI to move an existing user | `scripts/assign-company.mjs` only | Edit-user screen |
| Rename fans out per user | Cost of the no-Companies-table model | Companies table, if needed |
| Stores outside `createDynamoEntityStore` unfiltered | `risk-models`, `bidding-workspace`, `tracking-messages`, `workspace-settings` still return all tenants | Next pass |
| Driver portal unfiltered | Drivers are tenant-exempt; scope is `assignedDriver`, still a client-side scan | Rule B work |
| Sequential ids (`L-2800`…`L-3798`) | 999-value space, enumerable, collides across tenants | Stage 1 |

### Naming collision to be aware of

`CarrierRecord.companyName` is the **carrier's own** name — a business
attribute, unrelated to the tenant. The tenant key is `companyId` and only
`companyId`. Do not treat `CarrierRecord.companyName` as tenant data.
