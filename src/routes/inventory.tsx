import { createFileRoute } from "@tanstack/react-router";

import { InventoryPage } from "@/features/inventory/inventory-page";

export const Route = createFileRoute("/inventory")({
  head: () => ({
    meta: [
      { title: "Inventory — Logistics Software" },
      {
        name: "description",
        content:
          "Warehouse stock levels, allocations, cycle counts, and the movement ledger behind every unit.",
      },
    ],
  }),
  component: InventoryPage,
});
