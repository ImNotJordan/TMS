import * as React from "react";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, Building2, Loader2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CreateAccountDialog } from "./create-account-dialog";
import { EntityDetailSheet } from "./entity-detail-sheet";
import type { CrmAccountRecord } from "@/lib/crm-store";

export function AccountsPanel({
  accounts,
  loading,
  error,
  onRefresh,
}: {
  accounts: CrmAccountRecord[] | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  const [createOpen, setCreateOpen] = React.useState(false);
  const [selected, setSelected] = React.useState<CrmAccountRecord | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {loading ? "Loading…" : `${accounts?.length ?? 0} accounts`}
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> New Account
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-border/70">
        <Table>
          <TableHeader>
            <TableRow className="border-border/70">
              <TableHead className="pl-4">Account</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Owner</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (!accounts || accounts.length === 0) ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={`skel-${i}`} className="border-border/60">
                  {Array.from({ length: 5 }).map((__, j) => (
                    <TableCell key={j} className={j === 0 ? "pl-4" : ""}>
                      <Skeleton className="h-4 w-full max-w-[140px]" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : !accounts || accounts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                  <Building2 className="mx-auto mb-1 h-5 w-5" />
                  No accounts yet.
                </TableCell>
              </TableRow>
            ) : (
              accounts.map((a) => (
                <TableRow
                  key={a.accountId}
                  className="cursor-pointer border-border/60 hover:bg-muted/40"
                  onClick={() => setSelected(a)}
                >
                  <TableCell className="pl-4 font-medium text-foreground">{a.name}</TableCell>
                  <TableCell className="text-muted-foreground">{a.accountType ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{a.status ?? "—"}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {[a.city, a.state].filter(Boolean).join(", ") || "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{a.owner ?? "—"}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <CreateAccountDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={onRefresh} />

      {selected && (
        <EntityDetailSheet
          open={!!selected}
          onOpenChange={(open) => !open && setSelected(null)}
          title={selected.name}
          subtitle={[selected.accountType, selected.industry].filter(Boolean).join(" · ")}
          entityType="account"
          entityId={selected.accountId}
          fields={[
            { label: "Status", value: selected.status },
            { label: "Website", value: selected.website },
            { label: "Phone", value: selected.phone },
            { label: "Email", value: selected.email },
            { label: "City", value: selected.city },
            { label: "State", value: selected.state },
            { label: "Notes", value: selected.notes },
            ...(selected.carrierId
              ? [
                  {
                    label: "Carrier",
                    value: (
                      <Link
                        to="/carriers/$carrierId"
                        params={{ carrierId: selected.carrierId }}
                        className="text-primary underline-offset-2 hover:underline"
                      >
                        {selected.carrierId}
                      </Link>
                    ),
                  },
                ]
              : (selected.accountType === "Carrier" || selected.accountType === "Broker")
                ? [
                    {
                      label: "Carriers",
                      value: (
                        <Link
                          to="/carriers"
                          className="text-primary underline-offset-2 hover:underline"
                        >
                          Browse carriers
                        </Link>
                      ),
                    },
                  ]
                : []),
          ]}
        />
      )}
    </div>
  );
}
