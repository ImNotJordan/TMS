/**
 * The admin user directory.
 *
 *   GET /api/admin/users
 *
 * ## Why this exists
 *
 * The directory used to be assembled in the browser: `ListUsers` against the
 * pool, then a `.filter()` over the result. Two things were wrong with that,
 * and the second is the serious one.
 *
 * 1. The filter kept every user *without* a `companyId` visible, so that
 *    unassigned users stayed assignable. Rule B means Drivers never have one, so
 *    that temporary carve-out became permanent for every driver in the pool.
 *
 * 2. The filter ran **after** the data reached the browser. Scoping a list you
 *    have already downloaded is a presentation choice, not a boundary — every
 *    user's email, role and company was in the response regardless of what the
 *    screen chose to render.
 *
 * So the pool is read here, under the server's own principal, and the caller
 * receives only rows they may see. `cognito-idp:ListUsers` comes off the
 * Identity Pool role in the same change; without that this endpoint is just a
 * second way to ask the same question.
 *
 * ## Scoping
 *
 * The predicate is `isVisibleInDirectory` from [[directory-scope]], shared with
 * the client so the screen and the server cannot disagree about who is in the
 * list. Only this copy is a boundary.
 */
import { ListUsersCommand, type UserType } from "@aws-sdk/client-cognito-identity-provider";
import { BatchGetCommand } from "@aws-sdk/lib-dynamodb";

import { authorizeAdminRequest } from "@/lib/ai/ai-authz";
import { getAiDynamoClient, getProfileTable } from "@/lib/ai/server-aws";
import {
  ServerPrincipalMissingError,
  getServerCognitoClient,
  getServerUserPoolId,
} from "@/lib/ai/server-cognito";
import { strictRole } from "@/lib/tenant/strict-role";
import { requireCurrentTenantContext } from "@/lib/tenant/request-context";
import {
  logTenantDenial,
  tenantErrorResponse,
  type TenantContext,
} from "@/lib/tenant/server-tenant-context";
import { isVisibleInDirectory, type DirectoryScopeSubject } from "@/lib/tenant/directory-scope";

const PATH = "/api/admin/users";

/** Cognito caps a page at 60; the loop below drains every page. */
const PAGE_LIMIT = 60;

/** DynamoDB BatchGetItem caps at 100 keys per call. */
const BATCH_SIZE = 100;

export function isAdminUsersRequest(url: URL, method: string) {
  return method === "GET" && url.pathname === PATH;
}

function jsonError(message: string, status: number, code?: string) {
  return Response.json({ error: message, code }, { status });
}

export type AdminDirectoryUser = {
  id: string;
  email?: string;
  name?: string;
  phone?: string;
  role?: string;
  status?: string;
  companyId?: string;
  companyName?: string;
  employerCompanyId?: string;
  employerCompanyName?: string;
  inviteStatus?: string;
  lastLogin?: string;
  createdDate?: string;
};

function attr(user: UserType, name: string): string | undefined {
  return user.Attributes?.find((a) => a.Name === name)?.Value ?? undefined;
}

/** Cognito is the source of identity; the Profile row supplies the rest. */
function baseFromCognito(user: UserType): AdminDirectoryUser | null {
  const sub = attr(user, "sub");
  if (!sub) return null;

  const given = attr(user, "given_name");
  const family = attr(user, "family_name");
  const email = attr(user, "email");
  const name = [given, family].filter(Boolean).join(" ").trim() || attr(user, "nickname") || email;

  return {
    id: sub,
    email,
    name,
    phone: attr(user, "phone_number"),
    status: user.Enabled === false ? "Disabled" : user.UserStatus,
    inviteStatus: user.UserStatus,
    createdDate: user.UserCreateDate?.toISOString(),
  };
}

async function listPool(): Promise<AdminDirectoryUser[]> {
  const client = getServerCognitoClient();
  const userPoolId = getServerUserPoolId();
  const users: AdminDirectoryUser[] = [];
  let paginationToken: string | undefined;

  do {
    const out = await client.send(
      new ListUsersCommand({
        UserPoolId: userPoolId,
        PaginationToken: paginationToken,
        Limit: PAGE_LIMIT,
      }),
    );
    for (const user of out.Users ?? []) {
      const entry = baseFromCognito(user);
      if (entry) users.push(entry);
    }
    paginationToken = out.PaginationToken;
  } while (paginationToken);

  return users;
}

type PermissionsData = {
  role?: string;
  companyId?: string;
  companyName?: string;
  employerCompanyId?: string;
  employerCompanyName?: string;
  status?: string;
};

/**
 * Fetch the `permissions` Profile row for each user.
 *
 * BatchGetItem rather than a Scan: the Scan the old client fell back to read
 * every row of the table to answer a question about a known set of ids, and the
 * server principal is deliberately denied `dynamodb:Scan`.
 */
async function hydrateFromProfile(
  request: Request,
  users: AdminDirectoryUser[],
): Promise<Map<string, PermissionsData>> {
  const byUser = new Map<string, PermissionsData>();
  if (users.length === 0) return byUser;

  const client = await getAiDynamoClient(request);
  const table = getProfileTable();

  for (let i = 0; i < users.length; i += BATCH_SIZE) {
    const chunk = users.slice(i, i + BATCH_SIZE);
    let keys = chunk.map((user) => ({ userId: user.id, section: "permissions" }));

    // BatchGetItem may return UnprocessedKeys under throttling. Retrying them is
    // the difference between a complete directory and a silently short one.
    let attempts = 0;
    while (keys.length > 0 && attempts < 4) {
      const out = (await client.send(
        new BatchGetCommand({ RequestItems: { [table]: { Keys: keys } } }) as never,
      )) as {
        Responses?: Record<string, Array<{ userId?: string; data?: PermissionsData }>>;
        UnprocessedKeys?: Record<string, { Keys?: Array<{ userId: string; section: string }> }>;
      };

      for (const row of out.Responses?.[table] ?? []) {
        if (row.userId) byUser.set(row.userId, row.data ?? {});
      }

      keys = out.UnprocessedKeys?.[table]?.Keys ?? [];
      attempts += 1;
    }

    if (keys.length > 0) {
      // Say so rather than return a quietly incomplete directory.
      console.warn("[admin-users] profile hydration left keys unprocessed", {
        remaining: keys.length,
      });
    }
  }

  return byUser;
}

export async function handleAdminUsersRequest(request: Request): Promise<Response> {
  let ctx: TenantContext;
  try {
    ctx = await requireCurrentTenantContext(request);
  } catch (err) {
    return tenantErrorResponse(err) ?? jsonError("Sign in required.", 401, "not_authenticated");
  }

  // Admin-gated. `authorizeAdminRequest` denies on no role at all, unlike the
  // AI path — a directory of every colleague is not a default-open resource.
  const authorized = await authorizeAdminRequest(request);
  if (!authorized.ok) {
    logTenantDenial(ctx, "admin directory requested by a non-admin", PATH);
    return jsonError("You do not have access to the user directory.", 403, "forbidden");
  }

  /**
   * Cross-company listing is opt-in, even for a platform admin.
   *
   * Holding the privilege is not the same as wanting to use it. An admin who
   * belongs to a company expects to see that company; showing them every tenant
   * by default makes an ordinary screen look like a tenant leak, and makes a
   * real leak harder to notice among the noise.
   *
   * So `?scope=all` is required to widen it, and only a platform admin may ask.
   * The one exception is a platform admin with no company of their own — there
   * is nothing to scope to, and refusing would leave nobody able to onboard the
   * first company or repair a driver whose employer was never recorded.
   */
  const askedForAll = new URL(request.url).searchParams.get("scope") === "all";
  const crossCompany = ctx.isPlatformAdmin && (askedForAll || !ctx.companyId);

  if (askedForAll && !ctx.isPlatformAdmin) {
    logTenantDenial(ctx, "requested a cross-company directory without platform admin", PATH);
    return jsonError("You cannot list users outside your company.", 403, "forbidden");
  }

  // Fail closed rather than fall back to the whole pool. The old client listed
  // everyone with a warning when the admin had no company, to make the very
  // first assignment possible; that hole closes here because a platform admin
  // (Cognito group, not a stored role) can now do the bootstrap instead.
  if (!ctx.companyId && !ctx.isPlatformAdmin) {
    logTenantDenial(ctx, "admin directory requested without a company", PATH);
    return Response.json({
      users: [],
      warning:
        "Your account has no company assigned, so the directory is empty. Ask a platform " +
        "administrator to assign your company, or add yourself to the SuperAdmin group in " +
        "Cognito to administer across companies.",
      code: "no_company_context",
    });
  }

  try {
    const pool = await listPool();
    const profiles = await hydrateFromProfile(request, pool);

    const users: AdminDirectoryUser[] = [];
    for (const user of pool) {
      const profile = profiles.get(user.id) ?? {};
      // Resolved strictly: a fuzzy resolver that answers "Driver" for an
      // unexpected string would apply the employer rule to the wrong account.
      const role = strictRole(profile.role) ?? undefined;

      const subject: DirectoryScopeSubject = {
        role,
        companyId: profile.companyId,
        employerCompanyId: profile.employerCompanyId,
      };

      // `crossCompany`, not `ctx.isPlatformAdmin` — the privilege only applies
      // when it was actually invoked.
      if (!isVisibleInDirectory(subject, { ...ctx, isPlatformAdmin: crossCompany })) continue;

      users.push({
        ...user,
        role,
        status: profile.status ?? user.status,
        companyId: profile.companyId,
        companyName: profile.companyName,
        employerCompanyId: profile.employerCompanyId,
        employerCompanyName: profile.employerCompanyName,
      });
    }

    // Tell the caller which view they got. A platform admin sees every company,
    // which is correct but indistinguishable from a broken tenant filter unless
    // the screen says so.
    return Response.json({
      users,
      scope: crossCompany ? "platform" : "company",
      /** True when the caller *could* widen the view — drives the UI toggle. */
      canViewAllCompanies: ctx.isPlatformAdmin,
      ...(crossCompany
        ? {
            companyCount: new Set(
              users.map((u) => u.companyId ?? u.employerCompanyId).filter(Boolean),
            ).size,
          }
        : {}),
    });
  } catch (err) {
    if (err instanceof ServerPrincipalMissingError) {
      console.error("[admin-users] server principal is not configured");
      return jsonError("Server is not configured for administrative reads.", 503, err.code);
    }
    const name = err && typeof err === "object" ? (err as { name?: string }).name : undefined;
    console.error("[admin-users] directory read failed", name ?? err);
    return jsonError("Could not load the user directory.", 502, "error");
  }
}
