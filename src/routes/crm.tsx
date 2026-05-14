import { createFileRoute } from "@tanstack/react-router";
import { Briefcase } from "lucide-react";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const Route = createFileRoute("/crm")({
  head: () => ({
    meta: [
      { title: "CRM & Sales — Logistics Software" },
      { name: "description", content: "Pipeline of sales opportunities and broker/carrier relationships." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <ModulePlaceholder
      icon={Briefcase}
      title="CRM & Sales"
      description="Pipeline of sales opportunities and broker/carrier relationships."
      panels={[
    { label: "Open Opps", value: "92", tone: "info" },
    { label: "Pipeline Value", value: "$4.8M", tone: "success" },
    { label: "Won (MTD)", value: "18", tone: "success" },
    { label: "At Risk", value: "7", tone: "warning" }
      ]}
    />
  );
}
