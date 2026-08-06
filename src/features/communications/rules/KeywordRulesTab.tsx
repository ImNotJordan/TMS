import * as React from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
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
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";

import { useKeywordRules } from "../hooks/useKeywordRules";
import { keywordEngine, validateRegexTerm } from "../lib/keywordEngine";
import type { ChannelId, KeywordRule } from "../types";

function emptyRule(): KeywordRule {
  return {
    id: `rule-${crypto.randomUUID()}`,
    label: "",
    terms: [],
    matchType: "contains",
    caseSensitive: false,
    channels: ["email", "sms", "chat"],
    direction: "both",
    severity: "warning",
    actions: [{ type: "flag-thread" }],
    enabled: true,
  };
}

export function KeywordRulesTab() {
  const { rules, saveRule, removeRule, canEdit } = useKeywordRules();
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<KeywordRule | null>(null);
  const [previous, setPrevious] = React.useState<KeywordRule | undefined>();
  const [termInput, setTermInput] = React.useState("");
  const [testerText, setTesterText] = React.useState("");

  const openNew = () => {
    setPrevious(undefined);
    setDraft(emptyRule());
    setEditorOpen(true);
  };

  const openEdit = (rule: KeywordRule) => {
    setPrevious(rule);
    setDraft({ ...rule, terms: [...rule.terms], channels: [...rule.channels] });
    setEditorOpen(true);
  };

  const save = async () => {
    if (!draft || !canEdit) return;
    if (!draft.label.trim()) {
      toast.error("Rule label is required.");
      return;
    }
    if (draft.terms.length === 0) {
      toast.error("Add at least one term.");
      return;
    }
    if (draft.matchType === "regex") {
      for (const term of draft.terms) {
        const result = validateRegexTerm(term);
        if (!result.ok) {
          toast.error(result.reason);
          return;
        }
      }
    }
    try {
      await saveRule(draft, previous);
      setEditorOpen(false);
      toast.success("Keyword rule saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save rule.");
    }
  };

  const hits = keywordEngine(
    testerText,
    rules.filter((r) => r.enabled),
    { channel: "sms", direction: "inbound" },
  );

  return (
    <div className="space-y-4">
      <Card className="border-border/70 shadow-sm">
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">Keyword rules</CardTitle>
              <CardDescription>
                Flag detention, breakdowns, rate changes, and other high-signal phrases.
                Presets load disabled so you can turn them on when ready.
              </CardDescription>
            </div>
            {canEdit ? (
              <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={openNew}>
                <Plus className="h-3.5 w-3.5" />
                Add rule
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          {rules.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No keyword rules yet. Add one to start flagging messages.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Label</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Terms</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((rule) => (
                  <TableRow key={rule.id}>
                    <TableCell className="font-medium">{rule.label}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        {rule.severity}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[240px] truncate" title={rule.terms.join(", ")}>
                      {rule.terms.join(", ")}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={rule.enabled}
                        disabled={!canEdit}
                        onCheckedChange={(enabled) => void saveRule({ ...rule, enabled }, rule)}
                      />
                    </TableCell>
                    <TableCell className="space-x-2 text-right">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!canEdit}
                        onClick={() => openEdit(rule)}
                      >
                        Edit
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!canEdit}
                        onClick={() => void removeRule(rule.id)}
                      >
                        Remove
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/70 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Rule tester</CardTitle>
          <CardDescription>Paste sample text to see which enabled rules fire.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={testerText}
            onChange={(e) => setTesterText(e.target.value)}
            rows={4}
            placeholder="Driver is waiting — detention starting soon."
          />
          {hits.length === 0 ? (
            <p className="text-sm text-muted-foreground">No matches.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {hits.map((hit) => (
                <li key={`${hit.ruleId}-${hit.offset}`}>
                  <Badge variant="outline" className="mr-2 capitalize">
                    {hit.severity}
                  </Badge>
                  {hit.label} matched “{hit.matchedTerm}” at offset {hit.offset}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Sheet
        open={editorOpen}
        onOpenChange={(open) => {
          setEditorOpen(open);
          if (!open) setDraft(null);
        }}
      >
        <SheetContent className="overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{previous ? "Edit rule" : "New rule"}</SheetTitle>
            <SheetDescription>Terms, match type, severity, and actions.</SheetDescription>
          </SheetHeader>
          {draft ? (
            <div className="mt-4 space-y-3">
              <div className="space-y-1">
                <Label>Label</Label>
                <Input
                  value={draft.label}
                  onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>Terms</Label>
                <div className="flex gap-2">
                  <Input
                    value={termInput}
                    onChange={(e) => setTermInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && termInput.trim()) {
                        e.preventDefault();
                        setDraft({
                          ...draft,
                          terms: [...draft.terms, termInput.trim()],
                        });
                        setTermInput("");
                      }
                    }}
                    placeholder="Add term and press Enter"
                  />
                </div>
                <div className="flex flex-wrap gap-1 pt-1">
                  {draft.terms.map((term) => (
                    <Badge
                      key={term}
                      variant="outline"
                      className="cursor-pointer"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          terms: draft.terms.filter((t) => t !== term),
                        })
                      }
                    >
                      {term} ×
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="space-y-1">
                <Label>Match type</Label>
                <Select
                  value={draft.matchType}
                  onValueChange={(v) =>
                    setDraft({ ...draft, matchType: v as KeywordRule["matchType"] })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="contains">Contains</SelectItem>
                    <SelectItem value="word">Whole word</SelectItem>
                    <SelectItem value="regex">Regex</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Severity</Label>
                <Select
                  value={draft.severity}
                  onValueChange={(v) =>
                    setDraft({ ...draft, severity: v as KeywordRule["severity"] })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="info">Info</SelectItem>
                    <SelectItem value="warning">Warning</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Channels</Label>
                <div className="flex flex-wrap gap-2">
                  {(["email", "sms", "voice", "chat"] as ChannelId[]).map((channel) => (
                    <Button
                      key={channel}
                      type="button"
                      size="sm"
                      variant={draft.channels.includes(channel) ? "secondary" : "outline"}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          channels: draft.channels.includes(channel)
                            ? draft.channels.filter((c) => c !== channel)
                            : [...draft.channels, channel],
                        })
                      }
                    >
                      {channel}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between rounded-md border border-border/70 px-3 py-2">
                <Label>Case sensitive</Label>
                <Switch
                  checked={draft.caseSensitive}
                  onCheckedChange={(v) => setDraft({ ...draft, caseSensitive: v })}
                />
              </div>
              <Button type="button" onClick={() => void save()}>
                Save rule
              </Button>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
