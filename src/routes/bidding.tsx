import { createFileRoute } from "@tanstack/react-router";
import { Gavel } from "lucide-react";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const Route = createFileRoute("/bidding")({
  head: () => ({
    meta: [
      { title: "Bidding — Logistics Software" },
      { name: "description", content: "Active and historical freight bids with win-rate insights." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <ModulePlaceholder
      icon={Gavel}
      title="Bidding"
      description="Active and historical freight bids with win-rate insights."
      panels={[
    { label: "Open Bids", value: "36", tone: "info" },
    { label: "Win Rate", value: "42.8%", tone: "success" },
    { label: "Avg Margin", value: "$184", tone: "default" },
    { label: "Expiring Today", value: "5", tone: "warning" }
      ]}
    />
  );
}
