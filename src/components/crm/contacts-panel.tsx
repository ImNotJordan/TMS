import * as React from "react";
import { AlertTriangle, Loader2, Plus, User } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CreateContactDialog } from "./create-contact-dialog";
import { EntityDetailSheet } from "./entity-detail-sheet";
import type { CrmAccountRecord, CrmContactRecord } from "@/lib/crm-store";

export function ContactsPanel({
  contacts,
  accounts,
  loading,
  error,
  onRefresh,
}: {
  contacts: CrmContactRecord[] | null;
  accounts: CrmAccountRecord[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  const [createOpen, setCreateOpen] = React.useState(false);
  const [selected, setSelected] = React.useState<CrmContactRecord | null>(null);

  const accountName = (accountId?: string) => accounts.find((a) => a.accountId === accountId)?.name;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {loading ? "Loading…" : `${contacts?.length ?? 0} contacts`}
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> New Contact
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
              <TableHead className="pl-4">Name</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Account</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Phone</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (!contacts || contacts.length === 0) ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={`skel-${i}`} className="border-border/60">
                  {Array.from({ length: 5 }).map((__, j) => (
                    <TableCell key={j} className={j === 0 ? "pl-4" : ""}>
                      <Skeleton className="h-4 w-full max-w-[140px]" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : !contacts || contacts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                  <User className="mx-auto mb-1 h-5 w-5" />
                  No contacts yet.
                </TableCell>
              </TableRow>
            ) : (
              contacts.map((c) => (
                <TableRow
                  key={c.contactId}
                  className="cursor-pointer border-border/60 hover:bg-muted/40"
                  onClick={() => setSelected(c)}
                >
                  <TableCell className="pl-4 font-medium text-foreground">
                    {c.firstName} {c.lastName}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{c.title ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{accountName(c.accountId) ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{c.email ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{c.phone ?? "—"}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <CreateContactDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={onRefresh}
        accounts={accounts}
      />

      {selected && (
        <EntityDetailSheet
          open={!!selected}
          onOpenChange={(open) => !open && setSelected(null)}
          title={`${selected.firstName} ${selected.lastName}`}
          subtitle={[selected.title, accountName(selected.accountId)].filter(Boolean).join(" · ")}
          entityType="contact"
          entityId={selected.contactId}
          fields={[
            { label: "Account", value: accountName(selected.accountId) },
            { label: "Title", value: selected.title },
            { label: "Email", value: selected.email },
            { label: "Phone", value: selected.phone },
            { label: "Notes", value: selected.notes },
          ]}
        />
      )}
    </div>
  );
}
