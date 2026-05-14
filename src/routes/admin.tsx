import { createFileRoute } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin — Logistics Software" },
      { name: "description", content: "User roles, permissions, company settings, audit logs, and integrations." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <ModulePlaceholder
      icon={Lock}
      title="Admin"
      description="User roles, permissions, company settings, audit logs, and integrations."
      panels={[
    { label: "Users", value: "84", tone: "info" },
    { label: "Roles", value: "7", tone: "default" },
    { label: "Audit Events (24h)", value: "2,418", tone: "success" },
    { label: "Pending Invites", value: "3", tone: "warning" }
      ]}
    />
  );
}
