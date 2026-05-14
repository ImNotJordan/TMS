import { createFileRoute } from "@tanstack/react-router";
import { BarChart3 } from "lucide-react";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const Route = createFileRoute("/analytics")({
  head: () => ({
    meta: [
      { title: "Analytics — Logistics Software" },
      { name: "description", content: "Operational, financial, and performance analytics across the network." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <ModulePlaceholder
      icon={BarChart3}
      title="Analytics"
      description="Operational, financial, and performance analytics across the network."
      panels={[
    { label: "Revenue (MTD)", value: "$2.41M", tone: "success" },
    { label: "Margin", value: "18.4%", tone: "default" },
    { label: "OTD %", value: "96.8%", tone: "success" },
    { label: "Carrier Score", value: "92.4", tone: "info" }
      ]}
    />
  );
}
