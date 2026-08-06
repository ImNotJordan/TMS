import { getActiveGeocodeProviderLabel } from "@/lib/integrations-config";
import { useIntegrationsConfig } from "@/hooks/use-integrations-config";

/** Workspace Google Maps integration from Settings → Integrations (AWS + in-memory cache). */
export function useGoogleMapsIntegration() {
  const integration = useIntegrationsConfig();
  const apiKey = integration.config.googleMaps.apiKey.trim();
  const mapsActive =
    integration.enabled && integration.config.googleMaps.enabled && apiKey.length > 0;

  return {
    ...integration,
    apiKey,
    mapsActive,
    providerLabel: getActiveGeocodeProviderLabel(),
  };
}
