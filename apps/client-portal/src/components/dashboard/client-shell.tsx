import type { ReactNode } from "react";
import { LogOut } from "lucide-react";

import { AppLogoMark } from "@/components/app-logo-mark";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";

export function ClientShell({
  companyName,
  children,
}: {
  companyName?: string;
  children: ReactNode;
}) {
  const { client, signOut } = useAuth();

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="relative z-20 flex h-14 shrink-0 items-center gap-3 border-b border-border/80 bg-card/90 px-4 backdrop-blur-md">
        <AppLogoMark className="h-8 w-8 rounded-md" />
        <div className="min-w-0">
          <div className="text-sm font-bold tracking-tight text-foreground">Titan Freight</div>
          <div className="truncate text-[11px] text-muted-foreground">
            {companyName || "Client portal"}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <div className="hidden text-right sm:block">
            <div className="text-xs font-semibold text-foreground">{client?.name}</div>
            <div className="text-[11px] text-muted-foreground">{client?.email}</div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="cursor-pointer"
            onClick={() => void signOut()}
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </Button>
        </div>
      </header>
      <main className="relative min-h-0 flex-1">{children}</main>
    </div>
  );
}
