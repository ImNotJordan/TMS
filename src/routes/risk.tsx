import { createFileRoute } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const Route = createFileRoute("/risk")({
  head: () => ({
    meta: [
      { title: "Risk Models — Logistics Software" },
      { name: "description", content: "Predictive risk scoring across lanes, carriers, and shipments." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <ModulePlaceholder
      icon={ShieldAlert}
      title="Risk Models"
      description="Predictive risk scoring across lanes, carriers, and shipments."
      panels={[
    { label: "High-Risk Loads", value: "9", tone: "warning" },
    { label: "Avg Risk Score", value: "32", tone: "default" },
    { label: "Models Active", value: "7", tone: "info" },
    { label: "Mitigated (30d)", value: "118", tone: "success" }
      ]}
    />
  );
}
