import { createFileRoute } from "@tanstack/react-router";

import { BiddingPage } from "@/features/bidding/bidding-page";

export const Route = createFileRoute("/bidding")({
  head: () => ({
    meta: [
      { title: "Bidding Workspace - Logistics Software" },
      {
        name: "description",
        content:
          "Premium spot-load bidding workspace with lane search, DAT intelligence, risk scoring, leverage signals, and AI bid recommendations.",
      },
    ],
  }),
  component: BiddingPage,
});
