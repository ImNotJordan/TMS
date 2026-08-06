import { createFileRoute } from "@tanstack/react-router";

import { AdminPage } from "@/features/admin/admin-page";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin - Logistics Software" },
      {
        name: "description",
        content:
          "Enterprise admin control center for users, roles, permissions, invites, security, and audit logs.",
      },
    ],
  }),
  component: AdminPage,
});
