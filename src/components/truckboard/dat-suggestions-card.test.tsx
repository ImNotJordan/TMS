import { afterEach, describe, expect, it } from "vitest";

import { renderToStaticMarkup } from "react-dom/server";

import { DatSuggestionsCard } from "@/components/truckboard/dat-suggestions-card";
import { clearAppSettingsCache, setAppSettingsCache } from "@/lib/app-settings-store";

function textOf(markup: string): string {
  return markup
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

afterEach(() => {
  clearAppSettingsCache();
});

const LANE = {
  originCity: "Dallas",
  originState: "TX",
  destinationCity: "Atlanta",
  destinationState: "GA",
  equipmentType: "Dry Van",
};

describe("DAT suggestions on TruckBoard honour Integrations settings", () => {
  it("shows the card when the TruckBoard toggle is on", () => {
    setAppSettingsCache({ show_dat_suggestions_truckboard: true });
    const text = textOf(renderToStaticMarkup(<DatSuggestionsCard lane={LANE} />));
    expect(text).toContain("DAT Market Suggestions");
    expect(text).toContain("DAT Capacity Score");
  });

  it("renders nothing when the TruckBoard toggle is off", () => {
    setAppSettingsCache({ show_dat_suggestions_truckboard: false });
    const markup = renderToStaticMarkup(<DatSuggestionsCard lane={LANE} />);
    expect(markup).toBe("");
  });
});
