/**
 * The companies that exist, derived server-side.
 *
 * ## Why this is not a table
 *
 * The lightweight company model has no `Companies` table: a company exists
 * because users reference it. That trade was deliberate, and it holds — but it
 * left nobody responsible for deciding whether a company is *new*.
 *
 * The client answered that question from the directory it happened to be
 * showing, minted a fresh id when a typed name did not match, and the server
 * accepted the id it was handed. So "HHI" was created twice: once by an admin
 * who could see the existing one, once by an admin who could not. Two tenants,
 * one display name, and nothing in any screen to tell them apart because every
 * screen shows the name while records are keyed by the id.
 *
 * This module makes the server answer instead. It is the same derivation, but
 * it runs where the caller cannot influence it, and it sees every company
 * rather than the subset one admin is scoped to.
 *
 * ## Cost
 *
 * A pool listing plus a batched profile read. That is too expensive per page
 * load, which is why the directory endpoint does not use it — but company
 * assignment happens rarely, and correctness there is worth two API calls.
 */
import { ListUsersCommand } from "@aws-sdk/client-cognito-identity-provider";
import { BatchGetCommand } from "@aws-sdk/lib-dynamodb";

import {
  getAiDynamoClient,
  getProfileTable,
  getServerIamDynamoClient,
} from "@/lib/ai/server-aws";
import { getServerDataClient } from "@/lib/server/server-dynamo";
import { getServerCognitoClient, getServerUserPoolId } from "@/lib/ai/server-cognito";

export type KnownCompany = {
  companyId: string;
  companyName: string;
  userCount: number;
};

/** Compare display names the way a person would: case and spacing are noise. */
export function normalizeCompanyName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

const PAGE_LIMIT = 60;
const BATCH_SIZE = 100;

/** Every company referenced by any user, across all tenants. */
export async function listKnownCompanies(request?: Request): Promise<KnownCompany[]> {
  const cognito = getServerCognitoClient();
  const userPoolId = getServerUserPoolId();

  const subs: string[] = [];
  let paginationToken: string | undefined;
  do {
    const out = await cognito.send(
      new ListUsersCommand({
        UserPoolId: userPoolId,
        PaginationToken: paginationToken,
        Limit: PAGE_LIMIT,
      }),
    );
    for (const user of out.Users ?? []) {
      const sub = user.Attributes?.find((a) => a.Name === "sub")?.Value;
      if (sub) subs.push(sub);
    }
    paginationToken = out.PaginationToken;
  } while (paginationToken);

  if (subs.length === 0) return [];

  const client = request
    ? await getAiDynamoClient(request)
    : (getServerIamDynamoClient() ?? getServerDataClient());
  const table = getProfileTable();
  const byId = new Map<string, KnownCompany>();

  for (let i = 0; i < subs.length; i += BATCH_SIZE) {
    let keys = subs.slice(i, i + BATCH_SIZE).map((userId) => ({ userId, section: "permissions" }));
    let attempts = 0;
    while (keys.length > 0 && attempts < 4) {
      const out = (await client.send(
        new BatchGetCommand({ RequestItems: { [table]: { Keys: keys } } }) as never,
      )) as {
        Responses?: Record<
          string,
          Array<{
            data?: {
              companyId?: string;
              companyName?: string;
              employerCompanyId?: string;
              employerCompanyName?: string;
            };
          }>
        >;
        UnprocessedKeys?: Record<string, { Keys?: Array<{ userId: string; section: string }> }>;
      };

      for (const row of out.Responses?.[table] ?? []) {
        const data = row.data ?? {};
        // Both fields count: a Driver's employer is a reference to the same
        // company, and missing it would let a name look unused when it is not.
        for (const [id, name] of [
          [data.companyId, data.companyName],
          [data.employerCompanyId, data.employerCompanyName],
        ] as const) {
          const companyId = id?.trim();
          if (!companyId) continue;
          const existing = byId.get(companyId);
          if (existing) {
            existing.userCount += 1;
            if (!existing.companyName && name?.trim()) existing.companyName = name.trim();
          } else {
            byId.set(companyId, {
              companyId,
              companyName: name?.trim() ?? "",
              userCount: 1,
            });
          }
        }
      }

      keys = out.UnprocessedKeys?.[table]?.Keys ?? [];
      attempts += 1;
    }
  }

  return [...byId.values()];
}

/**
 * A company already using this name under a different id, if one exists.
 *
 * The check that would have prevented the duplicate: assigning someone to a
 * *new* id whose name is already taken is almost always a mis-typed match, not
 * a genuine second company with the same name.
 */
export function findNameCollision(
  companies: KnownCompany[],
  companyId: string,
  companyName: string,
): KnownCompany | null {
  const needle = normalizeCompanyName(companyName);
  if (!needle) return null;
  return (
    companies.find(
      (c) => c.companyId !== companyId && normalizeCompanyName(c.companyName) === needle,
    ) ?? null
  );
}
