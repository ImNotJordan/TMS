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
import { t } from "@/lib/i18n/t";

export function ComplianceTab() {
  const { canViewCompliance } = useCommsAccess();
  const { consentRecords, dncEntries, auditEvents, recordConsent, addDnc, removeDnc } =
    useCompliance();

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
          {t("Compliance is available to broker and admin roles only.")}
        </CardContent>
      </Card>
    );
  }

  const filteredConsent = consentRecords.filter((r) => {
    if (
      consentFilterContact &&
      !r.contactId.toLowerCase().includes(consentFilterContact.toLowerCase())
    ) {
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
        <TabsTrigger value="consent">{t("Consent log")}</TabsTrigger>
        <TabsTrigger value="dnc">{t("Do not contact")}</TabsTrigger>
        <TabsTrigger value="audit">{t("Audit")}</TabsTrigger>
      </TabsList>

      <TabsContent value="consent" className="space-y-4">
        <Card className="border-border/70 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t("Consent log")}</CardTitle>
            <CardDescription>{t("Append-only. Revoking creates a new record.")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Input
                placeholder={t("Filter by contact")}
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
                  <SelectItem value="all">{t("All channels")}</SelectItem>
                  <SelectItem value="email">{t("Email")}</SelectItem>
                  <SelectItem value="sms">SMS</SelectItem>
                  <SelectItem value="voice">{t("Voice")}</SelectItem>
                  <SelectItem value="chat">{t("Chat")}</SelectItem>
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
                {t("Record consent")}
              </Button>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("Contact")}</TableHead>
                  <TableHead>{t("Channel")}</TableHead>
                  <TableHead>{t("State")}</TableHead>
                  <TableHead>{t("Basis")}</TableHead>
                  <TableHead>{t("Captured")}</TableHead>
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
            <CardTitle className="text-base">{t("Do not contact")}</CardTitle>
            <CardDescription>
              {t("Additions take effect immediately on matching sends.")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 md:grid-cols-4">
              <div className="space-y-1">
                <Label>{t("Address")}</Label>
                <Input value={dncAddress} onChange={(e) => setDncAddress(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>{t("Channel")}</Label>
                <Select
                  value={dncChannel}
                  onValueChange={(v) => setDncChannel(v as ChannelId | "all")}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("All")}</SelectItem>
                    <SelectItem value="email">{t("Email")}</SelectItem>
                    <SelectItem value="sms">SMS</SelectItem>
                    <SelectItem value="voice">{t("Voice")}</SelectItem>
                    <SelectItem value="chat">{t("Chat")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label>{t("Reason")}</Label>
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
              {t("Add entry")}
            </Button>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("Address")}</TableHead>
                  <TableHead>{t("Channel")}</TableHead>
                  <TableHead>{t("Reason")}</TableHead>
                  <TableHead>{t("Added")}</TableHead>
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
                        {t("Remove")}
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
                <CardTitle className="text-base">{t("Audit log")}</CardTitle>
                <CardDescription>{t("Read-only. Filter and export to CSV.")}</CardDescription>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={exportAuditCsv}>
                {t("Export CSV")}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              placeholder={t("Filter by action")}
              value={auditAction}
              onChange={(e) => setAuditAction(e.target.value)}
              className="max-w-xs"
            />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("When")}</TableHead>
                  <TableHead>{t("Actor")}</TableHead>
                  <TableHead>{t("Action")}</TableHead>
                  <TableHead>{t("Target")}</TableHead>
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
