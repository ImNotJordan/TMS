/**
 * Risk models.
 *
 * ## Transport
 *
 * `/api/risk-models`, not DynamoDB. This store previously listed via a
 * full-table `Scan` with no tenant predicate at all — every company's risk
 * models, to anyone signed in. It is now a company-scoped Query like every other
 * resource.
 *
 * Exported names and signatures are unchanged so no screen moved.
 */
import { createApiBackedStore } from "./api/api-backed-store";

export type RiskModelRecord = {
  id: string;
  lastModified: string;
  [key: string]: unknown;
};

const store = createApiBackedStore<RiskModelRecord & { createdAt: string; updatedAt: string }>({
  resource: "risk-models",
  keys: { collection: "models", item: "model" },
  idKey: "id",
  kind: "riskModels",
});

export async function listRiskModels(): Promise<RiskModelRecord[]> {
  return store.listAll();
}

export async function listRiskModelsCached(options?: {
  force?: boolean;
  scope?: string;
}): Promise<RiskModelRecord[]> {
  return store.listAllCached(options);
}

export async function createRiskModel(record: RiskModelRecord): Promise<RiskModelRecord> {
  return store.create(record as never);
}

export async function updateRiskModel(record: RiskModelRecord): Promise<RiskModelRecord> {
  return store.update(record as never);
}

/** Upsert — the API distinguishes create from update, so this falls back on 404. */
export async function upsertRiskModel(record: RiskModelRecord): Promise<RiskModelRecord> {
  return store.put(record as never);
}

export async function deleteRiskModel(id: string): Promise<void> {
  return store.remove(id);
}
