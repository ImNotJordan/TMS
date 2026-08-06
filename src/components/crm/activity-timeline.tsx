import * as React from "react";
import {
  AlertTriangle,
  CalendarClock,
  Loader2,
  Mail,
  MessageSquare,
  Phone,
  PlusCircle,
  Radar,
  RefreshCcw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Users,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { FancySelect, type FancySelectOption } from "@/components/loads/fancy-select";
import { useAuth } from "@/lib/auth";
import {
  createCrmActivity,
  listCrmActivitiesForEntity,
  type CrmActivityEntityType,
  type CrmActivityRecord,
  type CrmActivityType,
} from "@/lib/crm-store";
import { formatTimestamp } from "./crm-shared";

const TYPE_ICON: Record<CrmActivityType, React.ComponentType<{ className?: string }>> = {
  call: Phone,
  email: Mail,
  note: MessageSquare,
  meeting: Users,
  dat_search: Radar,
  stage_change: RefreshCcw,
  campaign: Send,
};

const TYPE_OPTIONS: FancySelectOption[] = [
  { value: "note", label: "Note", icon: MessageSquare },
  { value: "call", label: "Call", icon: Phone },
  { value: "email", label: "Email", icon: Mail },
  { value: "meeting", label: "Meeting", icon: Users },
];

export function ActivityTimeline({
  entityType,
  entityId,
  refreshKey,
}: {
  entityType: CrmActivityEntityType;
  entityId: string;
  /** Bump to force a refetch (e.g. after the Prospecting Bot logs a new activity elsewhere). */
  refreshKey?: number;
}) {
  const { user } = useAuth();
  const [activities, setActivities] = React.useState<CrmActivityRecord[] | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [type, setType] = React.useState<string>("note");
  const [subject, setSubject] = React.useState("");
  const [body, setBody] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await listCrmActivitiesForEntity(entityType, entityId);
      setActivities(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load activity timeline.");
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId]);

  React.useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const handleAdd = async () => {
    if (!subject.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await createCrmActivity({
        activityId: generateActivityId(),
        entityType,
        entityId,
        type: type as CrmActivityType,
        subject: subject.trim(),
        body: body.trim() || undefined,
        createdBy: user?.userId,
      });
      setSubject("");
      setBody("");
      setType("note");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to log activity.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border/70 bg-card/60 p-3">
        <div className="flex gap-2">
          <div className="w-36 shrink-0">
            <FancySelect value={type} onChange={setType} options={TYPE_OPTIONS} searchable={false} />
          </div>
          <Input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="What happened?"
            className="flex-1"
          />
        </div>
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Details (optional)"
          rows={2}
          className="mt-2"
        />
        <div className="mt-2 flex justify-end">
          <Button size="sm" className="gap-1.5" disabled={!subject.trim() || submitting} onClick={handleAdd}>
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlusCircle className="h-3.5 w-3.5" />}
            Log activity
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </div>
      )}

      <div className="space-y-3">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="mt-0.5 h-7 w-7 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 rounded-lg border border-border/60 bg-card/40 px-3 py-2">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="mt-2 h-3 w-3/4" />
              </div>
            </div>
          ))
        ) : !activities || activities.length === 0 ? (
          <div className="flex flex-col items-center gap-1 py-8 text-center text-xs text-muted-foreground">
            <CalendarClock className="h-5 w-5" />
            No activity logged yet.
          </div>
        ) : (
          activities.map((a) => {
            const Icon = TYPE_ICON[a.type] ?? MessageSquare;
            return (
              <div key={a.activityId} className="flex gap-3">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1 rounded-lg border border-border/60 bg-card/40 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="truncate text-sm font-medium text-foreground">{a.subject}</div>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {formatTimestamp(a.createdAt)}
                    </span>
                  </div>
                  {a.body && <div className="mt-0.5 text-xs text-muted-foreground">{a.body}</div>}
                  {a.transcript && (
                    <pre className="mt-2 whitespace-pre-wrap rounded-md bg-muted/60 px-2 py-1.5 text-[11px] text-muted-foreground">
                      {a.transcript}
                    </pre>
                  )}
                  {a.datSearchUrl && (
                    <a
                      href={a.datSearchUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-primary underline-offset-2 hover:underline"
                    >
                      <Radar className="h-3 w-3" /> View DAT search
                    </a>
                  )}
                  {a.guardrailReason && (
                    <div
                      className={cn(
                        "mt-1.5 flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium",
                        a.guardrailAllowed
                          ? "bg-success/12 text-success"
                          : "bg-destructive/12 text-destructive",
                      )}
                    >
                      {a.guardrailAllowed ? (
                        <ShieldCheck className="h-3 w-3 shrink-0" />
                      ) : (
                        <ShieldAlert className="h-3 w-3 shrink-0" />
                      )}
                      {a.guardrailReason}
                    </div>
                  )}
                  {a.outcome && (
                    <Badge variant="secondary" className="mt-1.5">
                      {a.outcome}
                    </Badge>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function generateActivityId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `ACT-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `ACT-${Math.random().toString(36).slice(2, 10)}`;
}
