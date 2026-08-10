# IAM policies

Two policies. Real region, pool and table names already filled in — **replace
`<ACCOUNT_ID>` only** (IAM console → top-right account menu → 12-digit number).

Applying both is safe: nothing in the app breaks.

| # | Policy name | Attach to |
|---|---|---|
| 1 | `titan-server-settings` | New IAM **user** `titan-worker` |
| 2 | `titan-browser-authenticated` | Identity Pool **authenticated role** |

---

## Policy 1 — `titan-server-settings`

**Attach to:** a new IAM user named `titan-worker`.

**Where:** IAM → Users → Create user → name `titan-worker` → *do not* enable
console access → Next → **Attach policies directly** → Create policy → JSON tab
→ paste below → name it `titan-server-settings`.

Afterwards: open the user → Security credentials → **Create access key** →
*Application running outside AWS*. Copy both values.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "WorkspaceSettings",
      "Effect": "Allow",
      "Action": ["dynamodb:GetItem", "dynamodb:UpdateItem"],
      "Resource": "arn:aws:dynamodb:us-west-1:<ACCOUNT_ID>:table/WorkspaceSettings"
    },
    {
      "Sid": "ProfileTable",
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

Then put the access key in `.dev.vars` in the repo root (already gitignored):

```
TITAN_AWS_ACCESS_KEY_ID=AKIA...
TITAN_AWS_SECRET_ACCESS_KEY=...
TITAN_AWS_REGION=us-west-1
```

For production: `npx wrangler secret put TITAN_AWS_ACCESS_KEY_ID` (and the other
two).

---

## Policy 2 — `titan-browser-authenticated`

**Attach to:** the Identity Pool authenticated role.

**Where:** Cognito → Identity pools →
`us-west-1:78099ecd-f317-4a57-8ec2-8937ed3da270` → **User access** →
*Authenticated role* → click the role name (opens IAM) → **Add permissions** →
Create inline policy → JSON tab → paste below → name it
`titan-browser-authenticated`.

If the role already has an inline policy granting DynamoDB, **replace its
contents** with this rather than adding a second policy.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "OperationalTables",
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:Query",
        "dynamodb:Scan",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem"
      ],
      "Resource": [
        "arn:aws:dynamodb:us-west-1:<ACCOUNT_ID>:table/Loads",
        "arn:aws:dynamodb:us-west-1:<ACCOUNT_ID>:table/Loads/index/*",
        "arn:aws:dynamodb:us-west-1:<ACCOUNT_ID>:table/TruckBoard",
        "arn:aws:dynamodb:us-west-1:<ACCOUNT_ID>:table/TruckBoard/index/*",
        "arn:aws:dynamodb:us-west-1:<ACCOUNT_ID>:table/Carriers",
        "arn:aws:dynamodb:us-west-1:<ACCOUNT_ID>:table/Carriers/index/*",
        "arn:aws:dynamodb:us-west-1:<ACCOUNT_ID>:table/Quotes",
        "arn:aws:dynamodb:us-west-1:<ACCOUNT_ID>:table/RFPs",
        "arn:aws:dynamodb:us-west-1:<ACCOUNT_ID>:table/Invoices",
        "arn:aws:dynamodb:us-west-1:<ACCOUNT_ID>:table/TrackingMessages",
        "arn:aws:dynamodb:us-west-1:<ACCOUNT_ID>:table/RiskModels",
        "arn:aws:dynamodb:us-west-1:<ACCOUNT_ID>:table/BiddingWorkspace",
        "arn:aws:dynamodb:us-west-1:<ACCOUNT_ID>:table/CrmAccounts",
        "arn:aws:dynamodb:us-west-1:<ACCOUNT_ID>:table/CrmContacts",
        "arn:aws:dynamodb:us-west-1:<ACCOUNT_ID>:table/CrmLeads",
        "arn:aws:dynamodb:us-west-1:<ACCOUNT_ID>:table/CrmActivities",
        "arn:aws:dynamodb:us-west-1:<ACCOUNT_ID>:table/CrmCampaigns",
        "arn:aws:dynamodb:us-west-1:<ACCOUNT_ID>:table/CrmProspectingRuns",
        "arn:aws:dynamodb:us-west-1:<ACCOUNT_ID>:table/UsersTable",
        "arn:aws:dynamodb:us-west-1:<ACCOUNT_ID>:table/WorkspaceSettings"
      ]
    },
    {
      "Sid": "DenyWorkspaceSecrets",
      "Effect": "Deny",
      "Action": "dynamodb:*",
      "Resource": [
        "arn:aws:dynamodb:us-west-1:<ACCOUNT_ID>:table/WorkspaceSettings",
        "arn:aws:dynamodb:us-west-1:<ACCOUNT_ID>:table/WorkspaceSettings/index/*"
      ],
      "Condition": {
        "ForAnyValue:StringEquals": { "dynamodb:LeadingKeys": ["secrets"] }
      }
    },
    {
      "Sid": "CognitoAdminScopedToOwnPool",
      "Effect": "Allow",
      "Action": [
        "cognito-idp:ListUsers",
        "cognito-idp:AdminCreateUser",
        "cognito-idp:AdminGetUser",
        "cognito-idp:AdminUpdateUserAttributes",
        "cognito-idp:AdminSetUserPassword",
        "cognito-idp:AdminResetUserPassword"
      ],
      "Resource": "arn:aws:cognito-idp:us-west-1:<ACCOUNT_ID>:userpool/us-west-1_1CZpzcipb"
    }
  ]
}
```

### What this does and does not close

**Closes:** the OpenAI key. `DenyWorkspaceSecrets` blocks the browser from the
`secrets` partition, and an explicit `Deny` beats every `Allow`.

**Does not close:** `CognitoAdminScopedToOwnPool` still lets *any signed-in user,
including drivers*, list the pool and rewrite any user's attributes. It is
narrowed to one pool instead of `*`, which is better, but it is not a fix.

It stays for now because the admin panel calls those APIs from the browser
(create user, reset password, resend invite). When those move behind server
endpoints — the same pattern as company assignment — this statement gets deleted
and nothing is lost.

---

## Order

1. Policy 1 + `.dev.vars`.
2. Re-save the OpenAI key in Settings → Integrations. That writes it to the
   `secrets` partition through the server.
3. Policy 2.
4. Delete the old key from the `global/integrations` row, and **rotate it** — it
   has been readable by every browser.

Doing 3 before 1 breaks Logistics AI: with no `TITAN_AWS_*` the server falls back
to the caller's credentials, which the deny then blocks.
