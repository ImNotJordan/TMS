import { createFileRoute } from "@tanstack/react-router";
import { UserCircle2 } from "lucide-react";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [
      { title: "Profile — Logistics Software" },
      { name: "description", content: "Your personal details, preferences, security, and notifications." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <ModulePlaceholder
      icon={UserCircle2}
      title="Profile"
      description="Your personal details, preferences, security, and notifications."
      panels={[
    { label: "Profile Strength", value: "92%", tone: "success" },
    { label: "2FA", value: "Enabled", tone: "success" },
    { label: "API Tokens", value: "3", tone: "info" },
    { label: "Sessions", value: "2", tone: "default" }
      ]}
    />
  );
}
