# Stage 0 — IAM & secrets runbook

> **Paste-ready policy documents live in [iam-policies.md](./iam-policies.md)**,
> with this project's real region, pool and table names already filled in. This
> file explains *why*; that one is what you copy into the console.

Companion to the Stage 0 code changes. **The code changes alone do not close the
findings below.** The browser holds Cognito Identity Pool credentials and talks
directly to DynamoDB and Cognito, so any check written in `src/` runs inside the
attacker's own process. The controls in this document are the ones AWS enforces.

Apply in order. Steps 1 and 2 have user-visible consequences — read them before
running anything.

Placeholders: `<ACCOUNT>`, `<REGION>`, `<POOL_ID>`, `<IDENTITY_POOL_ID>`.

---

## 1. Remove Cognito admin power from every signed-in user

### The finding

`src/lib/cognito-admin.ts` calls `AdminCreateUser`, `AdminUpdateUserAttributes`
and `ListUsers` from the browser. Its own error message (line 200) tells you to
grant those to the Identity Pool authenticated role. If that was done, **every
signed-in user — including every driver — can enumerate the whole user pool,
create users, and rewrite any user's attributes.** That is full account takeover
and it does not require a `companyId` bug to exploit.

### Check what you have

```bash
aws cognito-identity get-identity-pool-roles \
  --identity-pool-id <IDENTITY_POOL_ID> --region <REGION>

# then, for the authenticated role ARN it prints:
aws iam list-attached-role-policies --role-name <AUTH_ROLE_NAME>
aws iam list-role-policies --role-name <AUTH_ROLE_NAME>
aws iam get-role-policy --role-name <AUTH_ROLE_NAME> --policy-name <NAME>
```

If any statement allows `cognito-idp:Admin*`, `cognito-idp:ListUsers`, or
`cognito-idp:*`, you have this finding.

### Fix

Remove every `cognito-idp` action from the authenticated role. Add this explicit
deny so a later grant elsewhere cannot silently re-open it:

```json
{
  "Sid": "DenyCognitoAdminFromBrowser",
  "Effect": "Deny",
  "Action": [
    "cognito-idp:Admin*",
    "cognito-idp:ListUsers",
    "cognito-idp:ListUsersInGroup",
    "cognito-idp:CreateGroup",
    "cognito-idp:UpdateGroup",
    "cognito-idp:DescribeUserPool",
    "cognito-idp:DescribeUserPoolClient"
  ],
  "Resource": "*"
}
```

Self-service Amplify calls (`updateUserAttributes`, `fetchUserAttributes`,
`changePassword`) are **not** affected — they are user-scoped API calls
authorized by the user's own token, not by the IAM role.

### What breaks

The Admin module loses: user directory listing, create user, reset password,
resend invite. `src/lib/admin-users-store.ts` already falls back to reading the
Profile table when Cognito is unavailable, so the directory degrades rather than
crashing, but the write operations will fail.

Pick one:

- **(a) Accept the breakage** until admin operations move server-side in Stage 1.
  Manage users in the AWS console meanwhile. Simplest, and safe.
- **(b) Interim: scope admin power to an admin group.** Add an `ops-admin` group
  in the user pool, switch the Identity Pool to **rules-based role mapping** on
  the `cognito:groups` claim, and give only the mapped admin role the
  `cognito-idp` actions. This takes the blast radius from *every user* to *admins
  only*, enforced by AWS with no code change.

  Note the residual: an admin's browser still holds pool-admin credentials, so
  XSS in an admin session is still full pool takeover. It is a large reduction,
  not a fix. The fix is Stage 1.

**Recommended: (b) now, (a)'s destination in Stage 1.**

---

## 2. Take the shared secrets row away from the browser

### The finding

`WorkspaceSettings` used a single hardcoded partition key `scope = "global"`
holding the workspace's **OpenAI API key** under `section = "integrations"`.
Every signed-in browser reads that row. Not just cross-tenant — cross-everything,
and directly billable to you.

### What changed in the code

The OpenAI key now lives under its **own partition key**, `scope = "secrets"`,
written and read only by the server
([settings-proxy.ts](../../src/lib/settings-proxy.ts),
[get-openai-key.ts](../../src/lib/ai/get-openai-key.ts)).

That split is load-bearing, not cosmetic. **`dynamodb:LeadingKeys` matches the
partition key only** — there is no IAM condition on a sort key, so a separate
`section` under `global` could never have been denied. An earlier draft of this
document proposed exactly that; it would not have worked.

### Fix

```json
{
  "Sid": "DenyWorkspaceSecretsToBrowser",
  "Effect": "Deny",
  "Action": "dynamodb:*",
  "Resource": [
    "arn:aws:dynamodb:<REGION>:<ACCOUNT>:table/WorkspaceSettings",
    "arn:aws:dynamodb:<REGION>:<ACCOUNT>:table/WorkspaceSettings/index/*"
  ],
  "Condition": {
    "ForAnyValue:StringEquals": { "dynamodb:LeadingKeys": ["secrets"] }
  }
}
```

The browser keeps access to `scope = "global"` (Google Maps key, feature flags,
test timestamps) and to the `ai-rl` / `ai-usage` partitions it legitimately
writes.

### Prerequisites — do these first

1. **Set `TITAN_AWS_ACCESS_KEY_ID` / `TITAN_AWS_SECRET_ACCESS_KEY`** as Worker
   secrets, with the policy in §3. Without them the server falls back to the
   caller's Identity Pool credentials, which this deny will block — AI would
   stop working.
2. **Re-save the OpenAI key** in Settings → Integrations. That writes it to the
   `secrets` partition via the new endpoint. Until then the server falls back to
   the legacy `global/integrations` row and logs a warning on every read.
3. **Then** apply the deny above.
4. Clear the key from the legacy row (re-saving does not remove it), and
   **rotate it** — see §4.

### What does not break

Settings → Integrations still works: the key is write-only from the browser.
`GET /api/settings/integrations/status` returns `connected`, `model` and the last
four characters — enough to show which key is installed, useless to an attacker.

### Google Maps stays readable, deliberately

The Maps JS SDK loads the key in the page
(`tracking-google-map.tsx`, `shipment-map.tsx`), so it **cannot** be secret. It
stays under `global`. Its control is restriction, not concealment — see §4.

---

## 3. Server principal — creating it

`TITAN_AWS_ACCESS_KEY_ID` / `TITAN_AWS_SECRET_ACCESS_KEY` is not configured yet.
Nothing that needs it works until it is: the settings endpoints and the company
assignment endpoint both return `503` rather than falling back to the caller's
credentials.

### 3a. Create the policy

IAM → **Policies** → **Create policy** → **JSON** tab. Paste the document in §3b,
replacing `<ACCOUNT_ID>` (IAM console, top-right account menu — the 12-digit
number) and `<PROFILE_TABLE>` (the value of `VITE_PROFILE_TABLE_NAME` in `.env`).
Name it `titan-server-settings`.

### 3b. Create the user

IAM → **Users** → **Create user** → name `titan-worker` → **do not** grant
console access → attach `titan-server-settings` directly.

Then open the user → **Security credentials** → **Create access key** → choose
*Application running outside AWS*. Copy both values now; the secret is shown once.

### 3c. Install the credentials

**Local dev** — create `.dev.vars` in the repo root (already gitignored):

```
TITAN_AWS_ACCESS_KEY_ID=AKIA...
TITAN_AWS_SECRET_ACCESS_KEY=...
TITAN_AWS_REGION=us-west-1
```

Do **not** put these in `.env`. Non-`VITE_` names there are not exposed to the
Worker, and `.env` is the wrong place for a credential regardless.

**Production** — Worker secrets, never a committed file:

```bash
npx wrangler secret put TITAN_AWS_ACCESS_KEY_ID
npx wrangler secret put TITAN_AWS_SECRET_ACCESS_KEY
npx wrangler secret put TITAN_AWS_REGION
```

### 3d. Rotate on a schedule

A long-lived access key is the weakest part of this design. Rotate it
periodically, and if the Worker ever moves to a platform with workload identity
(Lambda, ECS), drop the static key for a role.

---

## 3b. The policy — least privilege

`TITAN_AWS_ACCESS_KEY_ID` / `TITAN_AWS_SECRET_ACCESS_KEY` (`src/lib/ai/server-aws.ts`)
is the separate principal the brief calls for. It should be its own IAM user or
role with exactly this and nothing else:

Region, pool and table below are this project's real values — only
`<ACCOUNT_ID>` needs filling in.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "WorkspaceSettingsReadWrite",
      "Effect": "Allow",
      "Action": ["dynamodb:GetItem", "dynamodb:UpdateItem"],
      "Resource": "arn:aws:dynamodb:us-west-1:<ACCOUNT_ID>:table/WorkspaceSettings"
    },
    {
      "Sid": "ProfileRoleAndCompanyMirror",
      "Effect": "Allow",
      "Action": ["dynamodb:GetItem", "dynamodb:UpdateItem"],
      "Resource": "arn:aws:dynamodb:us-west-1:<ACCOUNT_ID>:table/UsersTable"
    },
    {
      "Sid": "CompanyAssignment",
      "Effect": "Allow",
      "Action": ["cognito-idp:AdminGetUser", "cognito-idp:AdminUpdateUserAttributes"],
      "Resource": "arn:aws:cognito-idp:us-west-1:<ACCOUNT_ID>:userpool/us-west-1_1CZpzcipb"
    }
  ]
}
```

This principal needs:

- `UpdateItem` on `WorkspaceSettings` — the OpenAI secret, the rate-limit
  counters (`ai-rl`), and the daily budget counter (`ai-usage`).
- `GetItem` + `UpdateItem` on the Profile table — resolving the caller's role for
  `authorizeAdminRequest`, and mirroring company assignment for the directory.
- `AdminGetUser` + `AdminUpdateUserAttributes` on the user pool — writing
  `custom:companyId` and `custom:sessionEpoch` during company assignment.

Note what it does **not** get: no `AdminCreateUser`, no `ListUsers`, no
`AdminDeleteUser`, and no access to any operational table (`Loads`, CRM,
`Invoices`, …). It is a settings-and-assignment principal, not a data principal
and not a full pool admin.

This is the pair to §1: those two `cognito-idp` actions moving here is what lets
them come off the browser's role.

Store the credentials as Cloudflare Worker secrets (`wrangler secret put`), never
in `.env`, `wrangler.jsonc`, or any committed file.

---

## 4. Rotate what has been exposed

The OpenAI key has been readable by every signed-in browser for the life of the
feature. Treat it as disclosed.

1. Create a new key in the OpenAI dashboard.
2. Set a **usage limit** on it — this is the cap on the damage from the next leak.
3. Save the new key (via the server endpoint once step 2's prerequisite lands).
4. Revoke the old key.
5. Review OpenAI usage history for consumption you cannot attribute.

Google Maps: the key **cannot** be hidden — the Maps JS API loads it in the
browser by design (`tracking-google-map.tsx`, `shipment-map.tsx`). The control is
restriction, not secrecy:

- **Application restriction:** HTTP referrers, your domains only.
- **API restriction:** Maps JavaScript API, Geocoding API, Directions API — nothing else.
- Set a billing budget alert.

Note that `facility-geocode.ts` and `google-maps-route.ts` send the key to your
own `/api/geocode` and `/api/directions` proxies in a header. Once the browser
can no longer read the integrations row, those proxies must read the key
server-side the same way the AI proxy does. Tracked below.

---

## 5. Verify

```bash
# As a normal signed-in user's credentials, each of these must now fail:
aws cognito-idp list-users --user-pool-id <POOL_ID>
aws dynamodb get-item --table-name WorkspaceSettings \
  --key '{"scope":{"S":"global"},"section":{"S":"integrations"}}'
```

Both should return `AccessDeniedException`. If either succeeds, the policy is not
in effect — check for a broader `Allow` elsewhere on the role, and remember an
explicit `Deny` always wins.

---

## Built — the server settings endpoint

Done, so step 2 is unblocked:

- `GET /api/settings/integrations/status` — verified token; returns
  `{ ai: { connected, model, last4, updatedAt } }`. Never the key.
- `POST /api/settings/integrations/ai` — verified token **plus an admin role**
  (`authorizeAdminRequest`: Organization Owner / Admin / SuperAdmin). Writes to
  the `secrets` partition under the `TITAN_AWS_*` principal. Omitting `apiKey`
  updates the model without re-entering a key the admin cannot read back.
- Client presence checks now use `readAiConnectionStatus()?.connected`;
  `getStoredAiApiKey()` is deprecated and returns `""` so any missed call site
  fails closed rather than type-erroring.
- The client-supplied-key path on `/api/ai/chat` is gone. `/api/ai/test` still
  accepts a draft key so Settings can validate before saving, but only for an
  authenticated, AI-authorized, rate-limited caller.

---

## What Stage 0 does not fix

Stated plainly so nothing here reads as more than it is:

- Every entity table (`Loads`, `Carriers`, CRM, `Quotes`, `RFPs`, `Invoices`, …)
  is still fully readable and writable by any signed-in user via a direct
  `Scan`/`PutItem`. There is no tenant boundary and no `companyId` anywhere in
  the schema.
- `putOwnSection`'s privileged-field guard is a client-side accident guard. A
  raw `PutItem` against another user's `permissions` row still works.
- Object ids remain sequential and enumerable (`L-2800`…`L-3798`, 999 values).

Those close in Stage 1, when data access moves behind the API tier and the
browser's DynamoDB permissions are revoked.
