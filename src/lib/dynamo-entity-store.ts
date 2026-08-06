import { DeleteCommand, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

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

/** Shared across all entity stores — avoids stacking per-store 300ms queues. */
const { runRead: globalReadLimited, runWrite: globalWriteLimited } =
  getGlobalDynamoRateLimiters();

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

export type DynamoEntityMeta = {
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
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
    return globalWriteLimited(async () => {
      try {
        const client = await getDynamoDocClient();
        const now = new Date().toISOString();
        const item = normalizeCreate
          ? normalizeCreate(input, now)
          : ({ ...input, createdAt: now, updatedAt: now } as T);
        await client.send(
          new PutCommand({
            TableName: table(),
            Item: item as Record<string, unknown>,
            ...(createIfNotExists
              ? { ConditionExpression: `attribute_not_exists(${idKey})` }
              : {}),
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

  async function listAll(): Promise<T[]> {
    return globalReadLimited(async () => {
      try {
        const client = await getDynamoDocClient();
        return await scanAllTableItems<T>(client, { TableName: table() });
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

  async function getById(id: string): Promise<T | null> {
    const trimmed = id?.trim();
    if (!trimmed) throw new Error(`${idKey} is required`);
    return globalReadLimited(async () => {
      try {
        const client = await getDynamoDocClient();
        const out = (await client.send(
          new GetCommand({
            TableName: table(),
            Key: { [idKey]: trimmed } as Record<string, unknown>,
          }) as unknown as Parameters<typeof client.send>[0],
        )) as { Item?: unknown };
        return (out.Item as T | undefined) ?? null;
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

  async function update(record: T): Promise<T> {
    const id = (record as Record<string, unknown>)[idKey];
    if (!id) throw new Error(`${idKey} is required`);
    return globalWriteLimited(async () => {
      try {
        const client = await getDynamoDocClient();
        const now = new Date().toISOString();
        const item = normalizeUpdate
          ? normalizeUpdate(record, now)
          : ({ ...record, updatedAt: now } as T);
        await client.send(
          new PutCommand({
            TableName: table(),
            Item: item as Record<string, unknown>,
            ...(updateIfExists ? { ConditionExpression: `attribute_exists(${idKey})` } : {}),
          }) as unknown as Parameters<typeof client.send>[0],
        );
        if (kind) {
          upsertOperationalListItem(kind, getOperationalCacheScope(), item, getId);
        }
        return item;
      } catch (err) {
        throw describeDynamoError(err, "PutItem(update)", label);
      }
    });
  }

  /** Upsert without existence condition (e.g. invoices). */
  async function put(record: T): Promise<T> {
    const id = (record as Record<string, unknown>)[idKey];
    if (!id) throw new Error(`${idKey} is required`);
    return globalWriteLimited(async () => {
      try {
        const client = await getDynamoDocClient();
        const now = new Date().toISOString();
        const item = normalizeUpdate
          ? normalizeUpdate(record, now)
          : ({ ...record, updatedAt: now } as T);
        await client.send(
          new PutCommand({
            TableName: table(),
            Item: item as Record<string, unknown>,
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

  async function remove(id: string): Promise<void> {
    const trimmed = id?.trim();
    if (!trimmed) throw new Error(`${idKey} is required`);
    return globalWriteLimited(async () => {
      try {
        const client = await getDynamoDocClient();
        await client.send(
          new DeleteCommand({
            TableName: table(),
            Key: { [idKey]: trimmed } as Record<string, unknown>,
            ...(updateIfExists
              ? { ConditionExpression: `attribute_exists(${idKey})` }
              : {}),
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
        throw describeDynamoError(err, "DeleteItem", label);
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
    put,
    remove,
    runReadLimited: globalReadLimited,
    runWriteLimited: globalWriteLimited,
  };
}
