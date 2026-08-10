/**
 * A store backed by the resource API instead of DynamoDB.
 *
 * Deliberately mirrors the surface of `createDynamoEntityStore` — same method
 * names, same signatures, same list-cache behaviour — so migrating a store is
 * swapping one factory call for another. Screens never learn that the transport
 * changed, which is what keeps ten migrations from becoming ten refactors.
 *
 * What is *not* carried over: `listAll` no longer scans, `getById` returns null
 * for another company's record rather than the record, and writes are scoped
 * server-side. Those are the point.
 */
import { createResourceClient } from "@/lib/api/resource-client";
import {
  fetchOperationalListCached,
  getOperationalCacheScope,
  readOperationalItemFromListCache,
  removeOperationalListItem,
  upsertOperationalListItem,
  type OperationalListKind,
} from "@/lib/operational-data-cache";

export type ApiBackedEntity = {
  createdAt: string;
  updatedAt: string;
  companyId?: string;
  createdBy?: string;
};

export type ApiBackedStoreOptions<T extends ApiBackedEntity> = {
  /** URL segment, matching a `resource-registry` entry. */
  resource: string;
  /** Response envelope keys the server uses. */
  keys: { collection: string; item: string };
  idKey: keyof T & string;
  /** Session list-cache bucket. */
  kind: OperationalListKind;
};

export function createApiBackedStore<T extends ApiBackedEntity>(options: ApiBackedStoreOptions<T>) {
  const { resource, keys, idKey, kind } = options;
  const api = createResourceClient<T>(resource, keys);
  const getId = (row: T) => (row as unknown as Record<string, unknown>)[idKey] as string;

  async function listAll(): Promise<T[]> {
    return api.list();
  }

  async function listAllCached(opts?: { force?: boolean; scope?: string }): Promise<T[]> {
    return fetchOperationalListCached({
      kind,
      scope: opts?.scope,
      force: opts?.force,
      getId,
      fetchRemote: () => api.list(),
    });
  }

  async function getById(id: string): Promise<T | null> {
    return api.get(id);
  }

  async function getByIdCached(
    id: string,
    opts?: { force?: boolean; scope?: string },
  ): Promise<T | null> {
    const trimmed = id?.trim();
    if (!trimmed) return null;
    const scope = opts?.scope ?? getOperationalCacheScope();

    if (!opts?.force) {
      const cached = readOperationalItemFromListCache<T>(kind, scope, trimmed, getId);
      if (cached) return cached;
    }

    const remote = await api.get(trimmed);
    if (remote) upsertOperationalListItem(kind, scope, remote, getId);
    return remote;
  }

  async function create(input: Omit<T, "createdAt" | "updatedAt">): Promise<T> {
    const created = await api.create(input as unknown as Record<string, unknown>);
    upsertOperationalListItem(kind, getOperationalCacheScope(), created, getId);
    return created;
  }

  async function update(record: T): Promise<T> {
    const updated = await api.update(getId(record), record as unknown as Record<string, unknown>);
    upsertOperationalListItem(kind, getOperationalCacheScope(), updated, getId);
    return updated;
  }

  /** Partial write — only the named attributes are sent. */
  async function patch(id: string, attributes: Partial<T>): Promise<void> {
    const updated = await api.update(id, attributes as Record<string, unknown>);
    upsertOperationalListItem(kind, getOperationalCacheScope(), updated, getId);
  }

  /**
   * Upsert. The API distinguishes create from update, so this tries an update
   * and falls back to a create when nothing matched — the same net effect the
   * unconditional Put had, without granting a blind overwrite.
   */
  async function put(record: T): Promise<T> {
    try {
      return await update(record);
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status !== 404) throw err;
      return create(record as unknown as Omit<T, "createdAt" | "updatedAt">);
    }
  }

  async function remove(id: string): Promise<void> {
    await api.remove(id);
    removeOperationalListItem(
      kind,
      getOperationalCacheScope(),
      id,
      getId as unknown as (row: { updatedAt: string }) => string,
    );
  }

  return { create, listAll, listAllCached, getById, getByIdCached, update, patch, put, remove };
}
