import { createFileRoute } from "@tanstack/react-router";

import { CommunicationsPage } from "@/features/communications/CommunicationsPage";

export const Route = createFileRoute("/communications")({
  head: () => ({
    meta: [
      { title: "Communications — Logistics Software" },
      {
        name: "description",
        content:
          "Omnichannel inbox for email, SMS, voice, and chat with AI agent, keyword rules, and compliance.",
      },
    ],
  }),
  component: CommunicationsPage,
});
