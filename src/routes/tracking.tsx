import { createFileRoute } from "@tanstack/react-router";
import { MapPin } from "lucide-react";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const Route = createFileRoute("/tracking")({
  head: () => ({
    meta: [
      { title: "Tracking — Logistics Software" },
      { name: "description", content: "Live shipment visibility, ETA prediction, and milestone alerts." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <ModulePlaceholder
      icon={MapPin}
      title="Tracking"
      description="Live shipment visibility, ETA prediction, and milestone alerts."
      panels={[
    { label: "In Transit", value: "248", tone: "info" },
    { label: "At Risk", value: "12", tone: "warning" },
    { label: "On Time", value: "96.8%", tone: "success" },
    { label: "Delayed", value: "4", tone: "destructive" }
      ]}
    />
  );
}
