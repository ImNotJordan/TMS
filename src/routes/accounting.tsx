import { createFileRoute } from "@tanstack/react-router";
import { Wallet } from "lucide-react";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const Route = createFileRoute("/accounting")({
  head: () => ({
    meta: [
      { title: "Accounting — Logistics Software" },
      { name: "description", content: "Invoices, payments, aging reports, expenses, and revenue summaries." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <ModulePlaceholder
      icon={Wallet}
      title="Accounting"
      description="Invoices, payments, aging reports, expenses, and revenue summaries."
      panels={[
    { label: "AR Open", value: "$842K", tone: "info" },
    { label: "Overdue 30+", value: "$118K", tone: "warning" },
    { label: "Paid (MTD)", value: "$1.92M", tone: "success" },
    { label: "Expenses (MTD)", value: "$402K", tone: "default" }
      ]}
    />
  );
}
