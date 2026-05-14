import { createFileRoute } from "@tanstack/react-router";
import { Truck } from "lucide-react";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const Route = createFileRoute("/truckboard")({
  head: () => ({
    meta: [
      { title: "TruckBoard — Logistics Software" },
      { name: "description", content: "Available trucks, capacity, and matching for open loads." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <ModulePlaceholder
      icon={Truck}
      title="TruckBoard"
      description="Available trucks, capacity, and matching for open loads."
      panels={[
    { label: "Available Trucks", value: "184", tone: "success" },
    { label: "Posted Loads", value: "92", tone: "info" },
    { label: "Avg Match Time", value: "12m", tone: "default" },
    { label: "Auto-Matched", value: "37", tone: "success" }
      ]}
    />
  );
}
