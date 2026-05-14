import { createFileRoute } from "@tanstack/react-router";
import { FileSpreadsheet } from "lucide-react";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const Route = createFileRoute("/quotes")({
  head: () => ({
    meta: [
      { title: "Quotes — Logistics Software" },
      { name: "description", content: "Customer quotes, pricing rules, and approval workflows." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <ModulePlaceholder
      icon={FileSpreadsheet}
      title="Quotes"
      description="Customer quotes, pricing rules, and approval workflows."
      panels={[
    { label: "Pending", value: "58", tone: "warning" },
    { label: "Sent (Today)", value: "23", tone: "info" },
    { label: "Accepted (7d)", value: "104", tone: "success" },
    { label: "Avg Response", value: "1.8h", tone: "default" }
      ]}
    />
  );
}
