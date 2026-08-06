import { createFileRoute } from "@tanstack/react-router";

import { RiskPage } from "@/features/risk/risk-page";

export const Route = createFileRoute("/risk")({
  head: () => ({
    meta: [
      { title: "Risk Models - Logistics Software" },
      {
        name: "description",
        content:
          "Enterprise risk command center for model lifecycle management, explainable scoring, and governance.",
      },
    ],
  }),
  component: RiskPage,
});
