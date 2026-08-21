import * as React from "react";

import {
  APP_SETTINGS_CHANGED,
  ensureAppSettingsCache,
  getAppSettingBool,
  getAppSettingString,
  type AppSettingsData,
} from "@/lib/app-settings-store";

/**
 * Company toggles under Settings → Integrations & DAT Settings.
 *
 * These are policy flags, not connection probes. A missing key uses the same
 * defaults the Settings form ships with, so a company that has never opened
 * Integrations still sees DAT suggestions. An explicit `false` hides the
 * surface named in that field's title.
 */
export const DAT_FEATURE_DEFAULTS: AppSettingsData = {
  enable_dat_capacity_data: true,
  enable_dat_rate_data: true,
  default_dat_data_window: "Last 7 days",
  show_dat_suggestions_load_review: true,
  show_dat_suggestions_truckboard: true,
  show_dat_capacity_suggestions: true,
  show_market_rate_suggestions: true,
};

export const DAT_DISABLED_IN_SETTINGS_MESSAGE = "DAT data is disabled in Settings → Integrations.";

export type DatFeatureFlags = {
  capacityData: boolean;
  rateData: boolean;
  dataWindow: string;
  /** Settings title: "Show DAT Suggestions on Load Review". */
  showOnLoadReview: boolean;
  showLoadReviewCapacity: boolean;
  showLoadReviewRates: boolean;
  /** Settings title: "Show DAT Suggestions on TruckBoard". */
  showOnTruckboard: boolean;
  showTruckboardCapacity: boolean;
  showTruckboardRates: boolean;
};

export function readDatFeatureFlags(settings?: AppSettingsData | null): DatFeatureFlags {
  const capacityData = getAppSettingBool("enable_dat_capacity_data", true, settings);
  const rateData = getAppSettingBool("enable_dat_rate_data", true, settings);
  const showOnLoadReview = getAppSettingBool("show_dat_suggestions_load_review", true, settings);
  const showOnTruckboard = getAppSettingBool("show_dat_suggestions_truckboard", true, settings);
  const truckboardCapacitySetting = getAppSettingBool(
    "show_dat_capacity_suggestions",
    true,
    settings,
  );
  const truckboardRateSetting = getAppSettingBool("show_market_rate_suggestions", true, settings);

  const showLoadReviewCapacity = showOnLoadReview && capacityData;
  const showLoadReviewRates = showOnLoadReview && rateData;
  const showTruckboardCapacity = showOnTruckboard && truckboardCapacitySetting && capacityData;
  const showTruckboardRates = showOnTruckboard && truckboardRateSetting && rateData;

  return {
    capacityData,
    rateData,
    dataWindow: getAppSettingString("default_dat_data_window", "Last 7 days", settings),
    showOnLoadReview: showLoadReviewCapacity || showLoadReviewRates,
    showLoadReviewCapacity,
    showLoadReviewRates,
    showOnTruckboard: showTruckboardCapacity || showTruckboardRates,
    showTruckboardCapacity,
    showTruckboardRates,
  };
}

export function useDatFeatureFlags(): DatFeatureFlags {
  const [flags, setFlags] = React.useState(() => readDatFeatureFlags());

  React.useEffect(() => {
    let cancelled = false;
    void ensureAppSettingsCache(DAT_FEATURE_DEFAULTS).then(() => {
      if (!cancelled) setFlags(readDatFeatureFlags());
    });
    const sync = () => setFlags(readDatFeatureFlags());
    window.addEventListener(APP_SETTINGS_CHANGED, sync);
    return () => {
      cancelled = true;
      window.removeEventListener(APP_SETTINGS_CHANGED, sync);
    };
  }, []);

  return flags;
}
