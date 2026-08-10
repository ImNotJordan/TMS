/**
 * Tenant-scoped data access.
 *
 * ## The property this exists to guarantee
 *
 * **You cannot construct a query without a tenant.** Every method takes a
 * `TenantContext` as its first argument, and every one calls `requireCompanyId`
 * on it before touching DynamoDB. There is no overload, no options bag, and no
 * `listAll()` that skips it. A developer adding an endpoint next month gets
 * isolation because the signature gives them nothing else to call — not because
 * they remembered to add a filter, and not because a reviewer caught it.
 *
 * ## No Scan
 *
 * Listing goes through a GSI partitioned on `companyId`. `Scan` is absent from
 * this module entirely, and that is deliberate: a `Scan` with a
 * `FilterExpression` reads every item in the table and *then* discards the ones
 * that do not match. It is billed for the whole table, it is slow, and — the
 * part that matters — a filter is not a boundary. The moment someone needs a
 * second predicate, the filter becomes the thing they edit.
 *
 * ## Writes are single scoped statements
 *
 * Updates and deletes carry `companyId = :ctxCompany` in their
 * `ConditionExpression`, in the same call that performs the write. Not
 * fetch-then-compare: between the read and the write a record can change hands,
 * and the check would pass against data that no longer exists. Zero rows matched
 * is reported as "not found", never as "forbidden" — telling a caller that a
 * record exists but is not theirs turns the id space into an oracle.
 *
 * ## The escape hatch
 *
 * There isn't one. A platform operator who needs to cross companies does so
 * through an endpoint that names the company explicitly and audits the crossing
 * — see `admin-company-proxy`. This module has no bypass flag, because a boolean
 * that disables tenant filtering will eventually be reachable through a bug.
 */
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  type QueryCommandInput,
} from "@aws-sdk/lib-dynamodb";

import { getServerDataClient } from "@/lib/server/server-dynamo";
import { requireCompanyId, type TenantContext } from "@/lib/tenant/server-tenant-context";

/** Attribute every tenant-scoped record carries. */
export const COMPANY_ID_ATTRIBUTE = "companyId";

export class RecordNotFoundError extends Error {
  readonly code = "NOT_FOUND";
  readonly status = 404;

  constructor(label: string) {
    // No id, no company, no hint about why. A caller probing ids learns nothing
    // from the difference between "absent" and "somebody else's".
    super(`${label} not found.`);
    this.name = "RecordNotFoundError";
  }
}

export type TenantEntity = {
  createdAt: string;
  updatedAt: string;
  companyId?: string;
  createdBy?: string;
};

export type TenantRepositorySpec<T extends TenantEntity> = {
  /** Resolved late so env changes in dev are picked up. */
  table: () => string;
  idKey: keyof T & string;
  /** Human label for error messages. Never includes tenant data. */
  label: string;
  /** GSI partitioned on `companyId`. Listing goes through this, never a Scan. */
  companyIndex: string;
};

function nowIso() {
  return new Date().toISOString();
}

/**
 * Page through a Query. Pagination lives here rather than at call sites so a
 * handler cannot accidentally return only the first page and call it a list.
 */
async function queryAll<T>(input: QueryCommandInput): Promise<T[]> {
  const client = getServerDataClient();
  const items: T[] = [];
  let cursor: Record<string, unknown> | undefined;

  do {
    const page = (await client.send(
      new QueryCommand({ ...input, ExclusiveStartKey: cursor }) as never,
    )) as { Items?: T[]; LastEvaluatedKey?: Record<string, unknown> };
    if (page.Items?.length) items.push(...page.Items);
    cursor = page.LastEvaluatedKey;
  } while (cursor);

  return items;
}

function isConditionFailure(err: unknown): boolean {
  return (err as { name?: string })?.name === "ConditionalCheckFailedException";
}

export function createTenantRepository<T extends TenantEntity>(spec: TenantRepositorySpec<T>) {
  const { idKey, label, companyIndex } = spec;
  const table = () => spec.table();

  /** Records belonging to the caller's company. */
  async function list(ctx: TenantContext): Promise<T[]> {
    const companyId = requireCompanyId(ctx);
    return queryAll<T>({
      TableName: table(),
      IndexName: companyIndex,
      KeyConditionExpression: `${COMPANY_ID_ATTRIBUTE} = :companyId`,
      ExpressionAttributeValues: { ":companyId": companyId },
    });
  }

  /**
   * One record, or `null`.
   *
   * Another company's record reads as absent. Deliberately not a distinct
   * "forbidden": that confirms the record exists.
   */
  async function get(ctx: TenantContext, id: string): Promise<T | null> {
    const companyId = requireCompanyId(ctx);
    const trimmed = id?.trim();
    if (!trimmed) return null;

    const client = getServerDataClient();
    const out = (await client.send(
      new GetCommand({
        TableName: table(),
        Key: { [idKey]: trimmed },
      }) as never,
    )) as { Item?: T };

    const item = out.Item;
    if (!item || item[COMPANY_ID_ATTRIBUTE] !== companyId) return null;
    return item;
  }

  /** As `get`, but throws rather than returning null. For handlers that 404. */
  async function getOrThrow(ctx: TenantContext, id: string): Promise<T> {
    const found = await get(ctx, id);
    if (!found) throw new RecordNotFoundError(label);
    return found;
  }

  /**
   * Create, stamped with the caller's company.
   *
   * `companyId` is applied last, so a value arriving on the input is overwritten
   * rather than merged. Which tenant owns a record is decided by who is asking,
   * never by the payload.
   */
  async function create(
    ctx: TenantContext,
    input: Omit<T, "createdAt" | "updatedAt" | "companyId">,
  ): Promise<T> {
    const companyId = requireCompanyId(ctx);
    const id = (input as Record<string, unknown>)[idKey];
    if (!id || typeof id !== "string") {
      throw new Error(`${idKey} is required to create a ${label} record.`);
    }

    const at = nowIso();
    const item = {
      ...input,
      createdAt: at,
      updatedAt: at,
      createdBy: ctx.userId,
      [COMPANY_ID_ATTRIBUTE]: companyId,
    } as T;

    const client = getServerDataClient();
    await client.send(
      new PutCommand({
        TableName: table(),
        Item: item as Record<string, unknown>,
        ConditionExpression: `attribute_not_exists(${idKey})`,
      }) as never,
    );
    return item;
  }

  /**
   * Patch named attributes on a record the caller's company owns.
   *
   * `companyId` and the id are silently excluded from the updatable set: a
   * record cannot be moved between tenants, or have its identity rewritten, by
   * an ordinary edit.
   */
  async function update(ctx: TenantContext, id: string, patch: Partial<T>): Promise<T> {
    const companyId = requireCompanyId(ctx);
    const trimmed = id?.trim();
    if (!trimmed) throw new RecordNotFoundError(label);

    const entries = Object.entries(patch).filter(
      ([key, value]) =>
        key !== idKey && key !== COMPANY_ID_ATTRIBUTE && key !== "createdAt" && value !== undefined,
    );
    if (entries.length === 0) return getOrThrow(ctx, trimmed);

    const names: Record<string, string> = { "#updatedAt": "updatedAt" };
    const values: Record<string, unknown> = {
      ":updatedAt": nowIso(),
      ":ctxCompany": companyId,
    };
    const sets = ["#updatedAt = :updatedAt"];
    entries.forEach(([key, value], i) => {
      names[`#a${i}`] = key;
      values[`:a${i}`] = value;
      sets.push(`#a${i} = :a${i}`);
    });

    try {
      const client = getServerDataClient();
      const out = (await client.send(
        new UpdateCommand({
          TableName: table(),
          Key: { [idKey]: trimmed },
          UpdateExpression: `SET ${sets.join(", ")}`,
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
          // Exists AND is ours, in one statement.
          ConditionExpression: `attribute_exists(${idKey}) AND ${COMPANY_ID_ATTRIBUTE} = :ctxCompany`,
          ReturnValues: "ALL_NEW",
        }) as never,
      )) as { Attributes?: T };
      return out.Attributes as T;
    } catch (err) {
      if (isConditionFailure(err)) throw new RecordNotFoundError(label);
      throw err;
    }
  }

  /** Delete a record the caller's company owns. Miss reads as not found. */
  async function remove(ctx: TenantContext, id: string): Promise<void> {
    const companyId = requireCompanyId(ctx);
    const trimmed = id?.trim();
    if (!trimmed) throw new RecordNotFoundError(label);

    try {
      const client = getServerDataClient();
      await client.send(
        new DeleteCommand({
          TableName: table(),
          Key: { [idKey]: trimmed },
          ConditionExpression: `attribute_exists(${idKey}) AND ${COMPANY_ID_ATTRIBUTE} = :ctxCompany`,
          ExpressionAttributeValues: { ":ctxCompany": companyId },
        }) as never,
      );
    } catch (err) {
      if (isConditionFailure(err)) throw new RecordNotFoundError(label);
      throw err;
    }
  }

  return { list, get, getOrThrow, create, update, remove };
}

export type TenantRepository<T extends TenantEntity> = ReturnType<typeof createTenantRepository<T>>;
