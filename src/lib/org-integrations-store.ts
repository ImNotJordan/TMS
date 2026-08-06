import {
  getWorkspaceSetting,
  loadLegacyIntegrationsFromProfileTable,
  putWorkspaceSetting,
} from "@/lib/workspace-settings-store";

export async function loadOrgIntegrationsFromDynamo<T extends Record<string, unknown>>() {
  return getWorkspaceSetting<T>("integrations");
}

export async function saveOrgIntegrationsToDynamo<T extends Record<string, unknown>>(config: T) {
  await putWorkspaceSetting("integrations", config);
}

export async function loadLegacyOrgIntegrationsFromProfileTable<
  T extends Record<string, unknown>,
>() {
  return loadLegacyIntegrationsFromProfileTable<T>();
}
