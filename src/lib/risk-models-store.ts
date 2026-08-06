import { DeleteCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

import {
  getAwsRegion,
  getDynamoDocClient,
  getRiskModelsTableName,
  isDynamoAccessDenied,
  isDynamoResourceNotFound,
  isRiskModelsConfigured,
  scanAllTableItems,
} from "./dynamodb";
import { createRateLimitedExecutor } from "./rate-limit";

const RISK_READ_RATE_LIMIT_MS = 300;
const RISK_WRITE_RATE_LIMIT_MS = 800;

const runReadLimited = createRateLimitedExecutor(RISK_READ_RATE_LIMIT_MS);
const runWriteLimited = createRateLimitedExecutor(RISK_WRITE_RATE_LIMIT_MS);

const CACHE_PREFIX = "titan-freight:risk-models:";
const DEFAULT_SCOPE = "_";

type CacheEntry<T> = {
  items: T[];
  fingerprint: string;
  loadedAt: string;
};

const memoryCache = new Map<string, CacheEntry<RiskModelRecord>>();
const inflight = new Map<string, Promise<RiskModelRecord[]>>();

export type RiskModelRecord = {
  id: string;
  lastModified: string;
  [key: string]: unknown;
};

function canUseSessionStorage() {
  return typeof window !== "undefined" && typeof sessionStorage !== "undefined";
}

function cacheKey(scope: string) {
  return `${CACHE_PREFIX}${scope}`;
}

function listFingerprint(items: RiskModelRecord[]) {
  if (items.length === 0) return "0";
  return items
    .map((row) => `${row.id}:${row.lastModified}`)
    .sort()
    .join("|");
}

function readSession(scope: string): CacheEntry<RiskModelRecord> | null {
  if (!canUseSessionStorage()) return null;
  try {
    const raw = sessionStorage.getItem(cacheKey(scope));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry<RiskModelRecord>;
    if (!parsed?.items || !Array.isArray(parsed.items)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeSession(scope: string, entry: CacheEntry<RiskModelRecord>) {
  if (!canUseSessionStorage()) return;
  try {
    sessionStorage.setItem(cacheKey(scope), JSON.stringify(entry));
  } catch {
    // ignore quota/storage errors
  }
}

function readCache(scope: string) {
  const memory = memoryCache.get(scope);
  if (memory) return memory;
  const session = readSession(scope);
  if (session) {
    memoryCache.set(scope, session);
    return session;
  }
  return undefined;
}

function writeCache(scope: string, items: RiskModelRecord[]) {
  const entry: CacheEntry<RiskModelRecord> = {
    items,
    fingerprint: listFingerprint(items),
    loadedAt: new Date().toISOString(),
  };
  memoryCache.set(scope, entry);
  writeSession(scope, entry);
  return entry;
}

function removeFromCache(scope: string, id: string) {
  const cached = readCache(scope);
  if (!cached) return;
  writeCache(
    scope,
    cached.items.filter((item) => item.id !== id),
  );
}

function upsertCache(scope: string, item: RiskModelRecord) {
  const cached = readCache(scope);
  const items = cached ? [...cached.items] : [];
  const idx = items.findIndex((row) => row.id === item.id);
  if (idx >= 0) items[idx] = item;
  else items.unshift(item);
  writeCache(scope, items);
}

function describeError(err: unknown, op: string): Error {
  if (err instanceof Error) {
    if (isDynamoResourceNotFound(err)) {
      const table = getRiskModelsTableName();
      const awsRegion = getAwsRegion() ?? "your AWS region";
      console.error(`[DynamoDB RiskModels ${op}] table not found`, err);
      return new Error(
        `DynamoDB table "${table}" was not found in ${awsRegion}. ` +
          `Create it with partition key "id" (String), then set ` +
          `VITE_RISK_MODELS_TABLE_NAME=${table} in .env.`,
      );
    }
    if (isDynamoAccessDenied(err)) {
      const table = getRiskModelsTableName();
      console.error(`[DynamoDB RiskModels ${op}] access denied`, err);
      return new Error(
        `Access denied for DynamoDB table "${table}". ` +
          `Add dynamodb:Scan, GetItem, PutItem, and DeleteItem on this table to your ` +
          `Cognito Identity Pool authenticated role.`,
      );
    }
    const awsName = (err as { name?: string }).name;
    const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    const detail = [awsName && `${awsName}`, status && `HTTP ${status}`, err.message]
      .filter(Boolean)
      .join(" · ");
    console.error(`[DynamoDB RiskModels ${op}]`, err);
    return new Error(`Risk Models ${op} failed: ${detail}`);
  }
  console.error(`[DynamoDB RiskModels ${op}]`, err);
  return new Error(`Risk Models ${op} failed`);
}

export async function listRiskModels(): Promise<RiskModelRecord[]> {
  if (!isRiskModelsConfigured()) return [];

  return runReadLimited(async () => {
    try {
      const client = await getDynamoDocClient();
      const items = await scanAllTableItems<RiskModelRecord>(client, {
        TableName: getRiskModelsTableName(),
      });
      return items.sort((a, b) => (a.lastModified < b.lastModified ? 1 : -1));
    } catch (err) {
      if (isDynamoResourceNotFound(err)) {
        console.warn(
          `[DynamoDB RiskModels Scan] table "${getRiskModelsTableName()}" not found — returning empty list.`,
          err,
        );
        return [];
      }
      throw describeError(err, "Scan");
    }
  });
}

export async function listRiskModelsCached(options?: {
  force?: boolean;
  scope?: string;
}): Promise<RiskModelRecord[]> {
  const scope = options?.scope ?? DEFAULT_SCOPE;
  const cached = readCache(scope);
  if (cached && !options?.force) {
    return cached.items;
  }

  const pending = inflight.get(scope);
  if (pending) return pending;

  const remotePromise = listRiskModels()
    .then((items) => {
      const remoteFp = listFingerprint(items);
      if (cached && options?.force && cached.fingerprint === remoteFp) {
        return cached.items;
      }
      writeCache(scope, items);
      return items;
    })
    .finally(() => {
      if (inflight.get(scope) === remotePromise) inflight.delete(scope);
    });

  inflight.set(scope, remotePromise);
  return remotePromise;
}

export async function createRiskModel(record: RiskModelRecord): Promise<RiskModelRecord> {
  if (!record.id?.trim()) throw new Error("id is required");
  if (!record.lastModified?.trim()) throw new Error("lastModified is required");
  if (!isRiskModelsConfigured()) {
    throw new Error(
      "Risk models table is not configured. Set VITE_RISK_MODELS_TABLE_NAME in .env.",
    );
  }

  return runWriteLimited(async () => {
    try {
      const client = await getDynamoDocClient();
      await client.send(
        new PutCommand({
          TableName: getRiskModelsTableName(),
          Item: record,
          ConditionExpression: "attribute_not_exists(id)",
        }),
      );
      upsertCache(DEFAULT_SCOPE, record);
      return record;
    } catch (err) {
      throw describeError(err, "Create");
    }
  });
}

export async function updateRiskModel(record: RiskModelRecord): Promise<RiskModelRecord> {
  if (!record.id?.trim()) throw new Error("id is required");
  if (!record.lastModified?.trim()) throw new Error("lastModified is required");
  if (!isRiskModelsConfigured()) {
    throw new Error(
      "Risk models table is not configured. Set VITE_RISK_MODELS_TABLE_NAME in .env.",
    );
  }

  return runWriteLimited(async () => {
    try {
      const client = await getDynamoDocClient();
      await client.send(
        new PutCommand({
          TableName: getRiskModelsTableName(),
          Item: record,
          ConditionExpression: "attribute_exists(id)",
        }),
      );
      upsertCache(DEFAULT_SCOPE, record);
      return record;
    } catch (err) {
      throw describeError(err, "Update");
    }
  });
}

export async function upsertRiskModel(record: RiskModelRecord): Promise<RiskModelRecord> {
  if (!record.id?.trim()) throw new Error("id is required");
  if (!record.lastModified?.trim()) throw new Error("lastModified is required");
  if (!isRiskModelsConfigured()) {
    throw new Error(
      "Risk models table is not configured. Set VITE_RISK_MODELS_TABLE_NAME in .env.",
    );
  }

  return runWriteLimited(async () => {
    try {
      const client = await getDynamoDocClient();
      await client.send(
        new PutCommand({
          TableName: getRiskModelsTableName(),
          Item: record,
        }),
      );
      upsertCache(DEFAULT_SCOPE, record);
      return record;
    } catch (err) {
      throw describeError(err, "Upsert");
    }
  });
}

export async function deleteRiskModel(id: string): Promise<void> {
  const modelId = id.trim();
  if (!modelId) throw new Error("id is required");
  if (!isRiskModelsConfigured()) {
    throw new Error(
      "Risk models table is not configured. Set VITE_RISK_MODELS_TABLE_NAME in .env.",
    );
  }

  return runWriteLimited(async () => {
    try {
      const client = await getDynamoDocClient();
      await client.send(
        new DeleteCommand({
          TableName: getRiskModelsTableName(),
          Key: { id: modelId },
          ConditionExpression: "attribute_exists(id)",
        }),
      );
      removeFromCache(DEFAULT_SCOPE, modelId);
    } catch (err) {
      throw describeError(err, "Delete");
    }
  });
}
