import { createFileRoute } from "@tanstack/react-router";
import { Building2 } from "lucide-react";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const Route = createFileRoute("/carriers")({
  head: () => ({
    meta: [
      { title: "Carriers / Brokers — Logistics Software" },
      { name: "description", content: "Carrier and broker network with scorecards, contracts, and contacts." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <ModulePlaceholder
      icon={Building2}
      title="Carriers / Brokers"
      description="Carrier and broker network with scorecards, contracts, and contacts."
      panels={[
    { label: "Active Carriers", value: "1,284", tone: "info" },
    { label: "Active Brokers", value: "342", tone: "default" },
    { label: "Top Tier", value: "118", tone: "success" },
    { label: "Watchlist", value: "23", tone: "warning" }
      ]}
    />
  );
}
