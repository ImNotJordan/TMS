import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { useCompliance } from "../hooks/useCompliance";
import { useCommsAccess } from "../hooks/useCommsAccess";
import type { ChannelId } from "../types";

export function ComplianceTab() {
  const { canViewCompliance } = useCommsAccess();
  const {
    consentRecords,
    dncEntries,
    auditEvents,
    recordConsent,
    addDnc,
    removeDnc,
  } = useCompliance();

  const [consentFilterContact, setConsentFilterContact] = React.useState("");
  const [consentFilterChannel, setConsentFilterChannel] = React.useState<ChannelId | "all">("all");
  const [dncAddress, setDncAddress] = React.useState("");
  const [dncReason, setDncReason] = React.useState("");
  const [dncChannel, setDncChannel] = React.useState<ChannelId | "all">("all");
  const [auditAction, setAuditAction] = React.useState("");

  if (!canViewCompliance) {
    return (
      <Card className="border-border/70 shadow-sm">
        <CardContent className="pt-6 text-sm text-muted-foreground">
          Compliance is available to broker and admin roles only.
        </CardContent>
      </Card>
    );
  }

  const filteredConsent = consentRecords.filter((r) => {
    if (consentFilterContact && !r.contactId.toLowerCase().includes(consentFilterContact.toLowerCase())) {
      return false;
    }
    if (consentFilterChannel !== "all" && r.channel !== consentFilterChannel) return false;
    return true;
  });

  const filteredAudit = auditEvents.filter((e) => {
    if (!auditAction.trim()) return true;
    return e.action.toLowerCase().includes(auditAction.toLowerCase());
  });

  const exportAuditCsv = () => {
    const header = "at,actorId,action,targetType,targetId\n";
    const rows = filteredAudit
      .map((e) =>
        [e.at, e.actorId, e.action, e.targetType, e.targetId]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(","),
      )
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `comms-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Tabs defaultValue="consent">
      <TabsList>
        <TabsTrigger value="consent">Consent log</TabsTrigger>
        <TabsTrigger value="dnc">Do not contact</TabsTrigger>
        <TabsTrigger value="audit">Audit</TabsTrigger>
      </TabsList>

      <TabsContent value="consent" className="space-y-4">
        <Card className="border-border/70 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Consent log</CardTitle>
            <CardDescription>Append-only. Revoking creates a new record.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Input
                placeholder="Filter by contact"
                value={consentFilterContact}
                onChange={(e) => setConsentFilterContact(e.target.value)}
                className="max-w-xs"
              />
              <Select
                value={consentFilterChannel}
                onValueChange={(v) => setConsentFilterChannel(v as ChannelId | "all")}
              >
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All channels</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="sms">SMS</SelectItem>
                  <SelectItem value="voice">Voice</SelectItem>
                  <SelectItem value="chat">Chat</SelectItem>
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  const contactId = window.prompt("Contact id");
                  if (!contactId) return;
                  void recordConsent({
                    contactId,
                    channel: "sms",
                    state: "granted",
                    basis: "explicit-optin",
                    capturedBy: "ops",
                    evidence: "Manual capture from Compliance tab",
                  }).then(() => toast.success("Consent recorded."));
                }}
              >
                Record consent
              </Button>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contact</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Basis</TableHead>
                  <TableHead>Captured</TableHead>
                  <TableHead>By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredConsent.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{row.contactId}</TableCell>
                    <TableCell>{row.channel}</TableCell>
                    <TableCell>{row.state}</TableCell>
                    <TableCell>{row.basis}</TableCell>
                    <TableCell>{new Date(row.capturedAt).toLocaleString()}</TableCell>
                    <TableCell>{row.capturedBy}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="dnc" className="space-y-4">
        <Card className="border-border/70 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Do not contact</CardTitle>
            <CardDescription>Additions take effect immediately on matching sends.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 md:grid-cols-4">
              <div className="space-y-1">
                <Label>Address</Label>
                <Input value={dncAddress} onChange={(e) => setDncAddress(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Channel</Label>
                <Select
                  value={dncChannel}
                  onValueChange={(v) => setDncChannel(v as ChannelId | "all")}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="sms">SMS</SelectItem>
                    <SelectItem value="voice">Voice</SelectItem>
                    <SelectItem value="chat">Chat</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label>Reason</Label>
                <Input value={dncReason} onChange={(e) => setDncReason(e.target.value)} />
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                void (async () => {
                  try {
                    const result = await addDnc({
                      address: dncAddress,
                      channel: dncChannel,
                      reason: dncReason,
                      addedBy: "ops",
                    });
                    toast.success(
                      `DNC added. Affects ${result.affectedConversations} conversation(s).`,
                    );
                    setDncAddress("");
                    setDncReason("");
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : "Could not add DNC.");
                  }
                })();
              }}
            >
              Add entry
            </Button>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Address</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {dncEntries.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{row.address}</TableCell>
                    <TableCell>{row.channel}</TableCell>
                    <TableCell className="max-w-[240px] truncate" title={row.reason}>
                      {row.reason}
                    </TableCell>
                    <TableCell>{new Date(row.addedAt).toLocaleString()}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void removeDnc(row.id)}
                      >
                        Remove
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="audit" className="space-y-4">
        <Card className="border-border/70 shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">Audit log</CardTitle>
                <CardDescription>Read-only. Filter and export to CSV.</CardDescription>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={exportAuditCsv}>
                Export CSV
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              placeholder="Filter by action"
              value={auditAction}
              onChange={(e) => setAuditAction(e.target.value)}
              className="max-w-xs"
            />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Target</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAudit.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{new Date(row.at).toLocaleString()}</TableCell>
                    <TableCell>{row.actorId}</TableCell>
                    <TableCell>{row.action}</TableCell>
                    <TableCell>
                      {row.targetType}:{row.targetId}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
