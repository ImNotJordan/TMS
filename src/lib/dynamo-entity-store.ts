import { DeleteCommand, GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

import { getDynamoDocClient, scanAllTableItems } from "./dynamodb";
import {
  fetchOperationalListCached,
  getOperationalCacheScope,
  readOperationalItemFromListCache,
  removeOperationalListItem,
  upsertOperationalListItem,
  type OperationalListKind,
} from "./operational-data-cache";
import { getGlobalDynamoRateLimiters } from "./rate-limit";
import {
  COMPANY_ID_ATTRIBUTE,
  belongsToCompany,
  ensureCompanyContext,
  filterByCompany,
  requireCompanyId,
} from "./tenant/company-context";

/** Shared across all entity stores — avoids stacking per-store 300ms queues. */
const { runRead: globalReadLimited, runWrite: globalWriteLimited } = getGlobalDynamoRateLimiters();

export function describeDynamoError(err: unknown, op: string, label: string): Error {
  if (err instanceof Error) {
    const awsName = (err as { name?: string }).name;
    const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    const detail = [awsName && `${awsName}`, status && `HTTP ${status}`, err.message]
      .filter(Boolean)
      .join(" · ");
    console.error(`[DynamoDB ${label} ${op}]`, err);
    return new Error(`DynamoDB ${op} failed: ${detail}`);
  }
  console.error(`[DynamoDB ${label} ${op}]`, err);
  return new Error(`DynamoDB ${op} failed`);
}

/**
 * A tenant-scoped write that matched nothing looks exactly like a record that
 * does not exist — because from the caller's side it does not. Reporting
 * "condition failed" would confirm the id belongs to somebody else.
 */
export function describeScopedWriteError(err: unknown, op: string, label: string): Error {
  const name = err && typeof err === "object" ? (err as { name?: string }).name : undefined;
  if (name === "ConditionalCheckFailedException") {
    console.warn(`[tenant] scoped ${op} on ${label} matched no record in the active company`);
    return new Error(`${label} record not found.`);
  }
  return describeDynamoError(err, op, label);
}

export type DynamoEntityMeta = {
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  /**
   * Tenant key, stamped server-of-record style from the signed-in user's
   * assigned company. Never accepted from a caller — see `create`.
   */
  companyId?: string;
};

export type CreateDynamoEntityStoreOptions<T extends DynamoEntityMeta> = {
  tableName: string | (() => string);
  idKey: keyof T & string;
  label: string;
  /** When set, list/get use operational list cache. */
  kind?: OperationalListKind;
  /** Put create: require attribute_not_exists (default true). */
  createIfNotExists?: boolean;
  /** Put update: require attribute_exists (default true). */
  updateIfExists?: boolean;
  /** Optional transform before create Put (e.g. defaults). */
  normalizeCreate?: (input: Omit<T, "createdAt" | "updatedAt">, now: string) => T;
  /** Optional transform before update Put. */
  normalizeUpdate?: (record: T, now: string) => T;
};

function resolveTableName(tableName: string | (() => string)): string {
  return typeof tableName === "function" ? tableName() : tableName;
}

/**
 * Shared Dynamo CRUD + optional list cache. Public store APIs should re-export
 * these methods under stable names so call sites do not change.
 */
export function createDynamoEntityStore<T extends DynamoEntityMeta>(
  opts: CreateDynamoEntityStoreOptions<T>,
) {
  const {
    idKey,
    label,
    kind,
    createIfNotExists = true,
    updateIfExists = true,
    normalizeCreate,
    normalizeUpdate,
  } = opts;

  const getId = (row: T) => (row as unknown as Record<string, unknown>)[idKey] as string;
  const table = () => resolveTableName(opts.tableName);

  async function create(input: Omit<T, "createdAt" | "updatedAt">): Promise<T> {
    const id = (input as Record<string, unknown>)[idKey];
    if (!id) {
      throw new Error(`${idKey} is required to create a ${label} record`);
    }
    // Resolved before the write so a user with no assigned company fails loudly
    // here, instead of creating an unstamped record no list will ever show.
    const companyId = await requireCompanyId();

    return globalWriteLimited(async () => {
      try {
        const client = await getDynamoDocClient();
        const now = new Date().toISOString();
        const base = normalizeCreate
          ? normalizeCreate(input, now)
          : ({ ...input, createdAt: now, updatedAt: now } as T);
        // Stamped last, so any `companyId` that arrived on the input is
        // overwritten rather than merged. Which tenant owns a record is decided
        // by who is signed in, never by the payload.
        const item = { ...base, [COMPANY_ID_ATTRIBUTE]: companyId } as T;
        await client.send(
          new PutCommand({
            TableName: table(),
            Item: item as Record<string, unknown>,
            ...(createIfNotExists ? { ConditionExpression: `attribute_not_exists(${idKey})` } : {}),
          }) as unknown as Parameters<typeof client.send>[0],
        );
        if (kind) {
          upsertOperationalListItem(kind, getOperationalCacheScope(), item, getId);
        }
        return item;
      } catch (err) {
        throw describeDynamoError(err, "PutItem", label);
      }
    });
  }

  /**
   * List the active company's records.
   *
   * The `FilterExpression` keeps other tenants' rows off the wire and out of the
   * session cache; the post-filter is the belt to that braces. Neither is a
   * security control — a filter is applied after the read, and the browser could
   * omit it entirely. It is enforcement of the *display*, and reduced exposure.
   */
  async function listAll(): Promise<T[]> {
    const context = await ensureCompanyContext();
    if (!context) return [];

    return globalReadLimited(async () => {
      try {
        const client = await getDynamoDocClient();
        const items = await scanAllTableItems<T>(client, {
          TableName: table(),
          FilterExpression: `${COMPANY_ID_ATTRIBUTE} = :companyId`,
          ExpressionAttributeValues: { ":companyId": context.companyId },
        });
        return filterByCompany(
          items as unknown as Record<string, unknown>[],
          context.companyId,
        ) as unknown as T[];
      } catch (err) {
        throw describeDynamoError(err, "Scan", label);
      }
    });
  }

  async function listAllCached(options?: { force?: boolean; scope?: string }): Promise<T[]> {
    if (!kind) return listAll();
    return fetchOperationalListCached({
      kind,
      scope: options?.scope,
      force: options?.force,
      getId,
      fetchRemote: listAll,
    });
  }

  /**
   * Fetch one record, scoped to the active company.
   *
   * Another company's record — and any record with no tenant stamp — returns
   * `null`, which callers already render as "not found". Deliberately not a
   * distinct "forbidden" result: telling a caller that an id exists but is not
   * theirs confirms the record and turns the id space into an oracle.
   */
  async function getById(id: string): Promise<T | null> {
    const trimmed = id?.trim();
    if (!trimmed) throw new Error(`${idKey} is required`);
    const context = await ensureCompanyContext();
    if (!context) return null;

    return globalReadLimited(async () => {
      try {
        const client = await getDynamoDocClient();
        const out = (await client.send(
          new GetCommand({
            TableName: table(),
            Key: { [idKey]: trimmed } as Record<string, unknown>,
          }) as unknown as Parameters<typeof client.send>[0],
        )) as { Item?: unknown };
        const item = (out.Item as T | undefined) ?? null;
        if (!belongsToCompany(item as Record<string, unknown> | null, context.companyId)) {
          return null;
        }
        return item;
      } catch (err) {
        throw describeDynamoError(err, "GetItem", label);
      }
    });
  }

  async function getByIdCached(
    id: string,
    options?: { force?: boolean; scope?: string },
  ): Promise<T | null> {
    const trimmed = id.trim();
    if (!trimmed) throw new Error(`${idKey} is required`);
    if (!kind) return getById(trimmed);
    const scope = options?.scope ?? getOperationalCacheScope();
    if (!options?.force) {
      const cached = readOperationalItemFromListCache<T>(kind, scope, trimmed, getId);
      if (cached) return cached;
    }
    const remote = await getById(trimmed);
    if (remote) {
      upsertOperationalListItem(kind, scope, remote, getId);
    }
    return remote;
  }

  /**
   * Whole-item update, scoped to the active company.
   *
   * The condition evaluates against the *stored* item, so a record belonging to
   * another company fails the write instead of being taken over. One statement,
   * not fetch-then-compare: a read followed by a check is a race, and under
   * concurrent writes the check can pass on data that has already changed.
   */
  async function update(record: T): Promise<T> {
    const id = (record as Record<string, unknown>)[idKey];
    if (!id) throw new Error(`${idKey} is required`);
    const companyId = await requireCompanyId();

    return globalWriteLimited(async () => {
      try {
        const client = await getDynamoDocClient();
        const now = new Date().toISOString();
        const base = normalizeUpdate
          ? normalizeUpdate(record, now)
          : ({ ...record, updatedAt: now } as T);
        // Re-stamped so a caller cannot move a record to another tenant by
        // editing the field on a record they legitimately own.
        const item = { ...base, [COMPANY_ID_ATTRIBUTE]: companyId } as T;
        await client.send(
          new PutCommand({
            TableName: table(),
            Item: item as Record<string, unknown>,
            ConditionExpression: [
              updateIfExists ? `attribute_exists(${idKey})` : null,
              `${COMPANY_ID_ATTRIBUTE} = :ctxCompany`,
            ]
              .filter(Boolean)
              .join(" AND "),
            ExpressionAttributeValues: { ":ctxCompany": companyId },
          }) as unknown as Parameters<typeof client.send>[0],
        );
        if (kind) {
          upsertOperationalListItem(kind, getOperationalCacheScope(), item, getId);
        }
        return item;
      } catch (err) {
        throw describeScopedWriteError(err, "PutItem(update)", label);
      }
    });
  }

  /**
   * Write only the named attributes, leaving every other attribute on the item alone.
   *
   * `update`/`put` send a whole-item Put built from a previously-read snapshot, so any
   * attribute another writer changed in between is silently reverted. When one app owns
   * a subset of the item (the ops console owns `trackingSession`; the driver portal owns
   * `driverWorkflowStatus`, `driverStatusHistory`, `documentAssets`, `driverGps`), use
   * this instead — a read-modify-write of the full item would clobber the other side.
   */
  async function patch(id: string, attributes: Partial<T>): Promise<void> {
    const trimmed = id?.trim();
    if (!trimmed) throw new Error(`${idKey} is required`);
    // `companyId` is not in the updatable field set — a record cannot be moved
    // between tenants by a normal write.
    const entries = Object.entries(attributes).filter(
      ([key, value]) => key !== idKey && key !== COMPANY_ID_ATTRIBUTE && value !== undefined,
    );
    if (entries.length === 0) return;
    const companyId = await requireCompanyId();

    await globalWriteLimited(async () => {
      try {
        const client = await getDynamoDocClient();
        const now = new Date().toISOString();
        const names: Record<string, string> = { "#updatedAt": "updatedAt" };
        const values: Record<string, unknown> = {
          ":updatedAt": now,
          ":ctxCompany": companyId,
        };
        const sets = ["#updatedAt = :updatedAt"];
        entries.forEach(([key, value], i) => {
          names[`#a${i}`] = key;
          values[`:a${i}`] = value;
          sets.push(`#a${i} = :a${i}`);
        });
        await client.send(
          new UpdateCommand({
            TableName: table(),
            Key: { [idKey]: trimmed } as Record<string, unknown>,
            UpdateExpression: `SET ${sets.join(", ")}`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
            ConditionExpression: `attribute_exists(${idKey}) AND ${COMPANY_ID_ATTRIBUTE} = :ctxCompany`,
          }) as unknown as Parameters<typeof client.send>[0],
        );
        if (kind) {
          const scope = getOperationalCacheScope();
          const cached = readOperationalItemFromListCache<T>(kind, scope, trimmed, getId);
          if (cached) {
            upsertOperationalListItem(
              kind,
              scope,
              { ...cached, ...attributes, updatedAt: now },
              getId,
            );
          }
        }
      } catch (err) {
        throw describeScopedWriteError(err, "UpdateItem", label);
      }
    });
  }

  /**
   * Upsert without an existence condition (e.g. invoices).
   *
   * Still tenant-scoped: the row may be new, but it may not already belong to
   * somebody else. `attribute_not_exists` covers the create case.
   */
  async function put(record: T): Promise<T> {
    const id = (record as Record<string, unknown>)[idKey];
    if (!id) throw new Error(`${idKey} is required`);
    const companyId = await requireCompanyId();

    return globalWriteLimited(async () => {
      try {
        const client = await getDynamoDocClient();
        const now = new Date().toISOString();
        const base = normalizeUpdate
          ? normalizeUpdate(record, now)
          : ({ ...record, updatedAt: now } as T);
        const item = { ...base, [COMPANY_ID_ATTRIBUTE]: companyId } as T;
        await client.send(
          new PutCommand({
            TableName: table(),
            Item: item as Record<string, unknown>,
            ConditionExpression: `attribute_not_exists(${COMPANY_ID_ATTRIBUTE}) OR ${COMPANY_ID_ATTRIBUTE} = :ctxCompany`,
            ExpressionAttributeValues: { ":ctxCompany": companyId },
          }) as unknown as Parameters<typeof client.send>[0],
        );
        if (kind) {
          upsertOperationalListItem(kind, getOperationalCacheScope(), item, getId);
        }
        return item;
      } catch (err) {
        throw describeScopedWriteError(err, "PutItem", label);
      }
    });
  }

  async function remove(id: string): Promise<void> {
    const trimmed = id?.trim();
    if (!trimmed) throw new Error(`${idKey} is required`);
    const companyId = await requireCompanyId();

    return globalWriteLimited(async () => {
      try {
        const client = await getDynamoDocClient();
        await client.send(
          new DeleteCommand({
            TableName: table(),
            Key: { [idKey]: trimmed } as Record<string, unknown>,
            ConditionExpression: [
              updateIfExists ? `attribute_exists(${idKey})` : null,
              `${COMPANY_ID_ATTRIBUTE} = :ctxCompany`,
            ]
              .filter(Boolean)
              .join(" AND "),
            ExpressionAttributeValues: { ":ctxCompany": companyId },
          }) as unknown as Parameters<typeof client.send>[0],
        );
        if (kind) {
          removeOperationalListItem(
            kind,
            getOperationalCacheScope(),
            trimmed,
            getId as unknown as (row: { updatedAt: string }) => string,
          );
        }
      } catch (err) {
        throw describeScopedWriteError(err, "DeleteItem", label);
      }
    });
  }

  return {
    create,
    listAll,
    listAllCached,
    getById,
    getByIdCached,
    update,
    patch,
    put,
    remove,
    runReadLimited: globalReadLimited,
    runWriteLimited: globalWriteLimited,
  };
}
