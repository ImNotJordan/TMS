import { createFileRoute } from "@tanstack/react-router";
import { DashboardPage } from "./index";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard - Logistics Software" },
      {
        name: "description",
        content: "Live operations command center: loads, bids, quotes, risk, revenue, and tracking.",
      },
    ],
  }),
  component: DashboardPage,
});
