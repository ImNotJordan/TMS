import { createFileRoute } from "@tanstack/react-router";
import { Package } from "lucide-react";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const Route = createFileRoute("/loads")({
  head: () => ({
    meta: [
      { title: "Loads — Logistics Software" },
      { name: "description", content: "Manage every load — from booking and dispatch to delivery and POD." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <ModulePlaceholder
      icon={Package}
      title="Loads"
      description="Manage every load — from booking and dispatch to delivery and POD."
      panels={[
    { label: "Active", value: "248", tone: "info" },
    { label: "Booked Today", value: "42", tone: "default" },
    { label: "Delivered (7d)", value: "612", tone: "success" },
    { label: "Exceptions", value: "7", tone: "warning" }
      ]}
    />
  );
}
