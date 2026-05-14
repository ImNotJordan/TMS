import { createFileRoute } from "@tanstack/react-router";
import { FileText } from "lucide-react";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const Route = createFileRoute("/rfps")({
  head: () => ({
    meta: [
      { title: "RFPs — Logistics Software" },
      { name: "description", content: "Request for proposal pipeline, lane allocation, and award tracking." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <ModulePlaceholder
      icon={FileText}
      title="RFPs"
      description="Request for proposal pipeline, lane allocation, and award tracking."
      panels={[
    { label: "Open RFPs", value: "14", tone: "info" },
    { label: "Lanes Submitted", value: "228", tone: "default" },
    { label: "Awarded", value: "61", tone: "success" },
    { label: "Closing This Week", value: "6", tone: "warning" }
      ]}
    />
  );
}
