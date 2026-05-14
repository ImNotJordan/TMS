import { createFileRoute } from "@tanstack/react-router";
import { Settings } from "lucide-react";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Logistics Software" },
      { name: "description", content: "Workspace preferences, integrations, and team configuration." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <ModulePlaceholder
      icon={Settings}
      title="Settings"
      description="Workspace preferences, integrations, and team configuration."
      panels={[
    { label: "Integrations", value: "12", tone: "info" },
    { label: "Custom Fields", value: "48", tone: "default" },
    { label: "Webhooks", value: "9", tone: "info" },
    { label: "API Calls (24h)", value: "184K", tone: "success" }
      ]}
    />
  );
}
