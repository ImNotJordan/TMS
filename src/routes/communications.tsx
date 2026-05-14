import { createFileRoute } from "@tanstack/react-router";
import { MessageSquare } from "lucide-react";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const Route = createFileRoute("/communications")({
  head: () => ({
    meta: [
      { title: "Communications — Logistics Software" },
      { name: "description", content: "Unified inbox: emails, calls, internal notes, and customer updates." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <ModulePlaceholder
      icon={MessageSquare}
      title="Communications"
      description="Unified inbox: emails, calls, internal notes, and customer updates."
      panels={[
    { label: "Unread", value: "14", tone: "warning" },
    { label: "Active Threads", value: "62", tone: "info" },
    { label: "Avg Response", value: "8m", tone: "success" },
    { label: "SLA Breach", value: "1", tone: "destructive" }
      ]}
    />
  );
}
