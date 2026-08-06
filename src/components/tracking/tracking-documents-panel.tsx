import * as React from "react";
import {
  Download,
  Eye,
  FileText,
  FileUp,
  ImageIcon,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatBytes } from "@/lib/load-documents";
import type { TrackingDocument } from "@/lib/tracking-workflow-store";
import { cn } from "@/lib/utils";

function prettyTime(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const toneBadge = {
  success: "bg-success/15 text-success border-success/20",
  warning: "bg-warning/20 text-warning-foreground border-warning/30",
  info: "bg-info/15 text-info border-info/20",
} as const;

function downloadAsset(doc: TrackingDocument) {
  if (!doc.viewUrl) return;
  const a = document.createElement("a");
  a.href = doc.viewUrl;
  a.download = doc.name || "document";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function TrackingDocumentsPanel({
  documents,
  onMarkPod,
}: {
  documents: TrackingDocument[];
  onMarkPod?: () => void;
}) {
  const [active, setActive] = React.useState<TrackingDocument | null>(null);
  const viewable = documents.filter((d) => d.type === "BOL" || d.type === "POD" || d.viewUrl);
  const receivedCount = documents.filter((d) => d.status === "Received").length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {receivedCount} of {documents.length} on file
          {viewable.some((d) => d.viewUrl) ? " · tap a driver upload to preview" : ""}
        </p>
        <div className="flex flex-wrap gap-2">
          {onMarkPod ? (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={onMarkPod}>
              <FileUp className="h-3.5 w-3.5" /> Mark POD received
            </Button>
          ) : null}
        </div>
      </div>

      <div className="space-y-2">
        {documents.map((doc) => {
          const canView = Boolean(doc.viewUrl);
          const isImage = Boolean(doc.contentType?.startsWith("image/") || doc.viewUrl?.startsWith("data:image"));
          return (
            <button
              key={doc.id}
              type="button"
              disabled={!canView}
              onClick={() => canView && setActive(doc)}
              className={cn(
                "flex w-full items-center gap-3 rounded-xl border border-border/70 bg-background/60 p-3 text-left transition-colors",
                canView
                  ? "hover:border-primary/35 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  : "cursor-default opacity-95",
              )}
            >
              <span
                className={cn(
                  "flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border/60",
                  canView ? "bg-muted/40" : "bg-muted/20",
                )}
              >
                {canView && isImage ? (
                  <img src={doc.viewUrl} alt="" className="h-full w-full object-cover" />
                ) : doc.type === "POD" || doc.type === "BOL" ? (
                  <FileText className="h-5 w-5 text-muted-foreground" />
                ) : (
                  <ImageIcon className="h-5 w-5 text-muted-foreground" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-foreground">{doc.name}</span>
                  {canView ? (
                    <Eye className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                  ) : null}
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {doc.type}
                  {doc.uploadedByName ? ` · ${doc.uploadedByName}` : ""}
                  {doc.uploadedAt ? ` · ${prettyTime(doc.uploadedAt)}` : " · not uploaded"}
                  {doc.size ? ` · ${formatBytes(doc.size)}` : ""}
                </span>
              </span>
              <Badge
                variant="outline"
                className={
                  toneBadge[
                    doc.status === "Received" ? "success" : doc.status === "Pending" ? "warning" : "info"
                  ]
                }
              >
                {doc.status}
              </Badge>
            </button>
          );
        })}
      </div>

      <Dialog open={!!active} onOpenChange={(open) => !open && setActive(null)}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-hidden p-0 sm:rounded-2xl">
          {active ? (
            <>
              <DialogHeader className="space-y-1 border-b border-border/70 px-5 py-4 text-left">
                <DialogTitle className="pr-8 text-base">{active.name}</DialogTitle>
                <DialogDescription>
                  {active.type}
                  {active.uploadedByName ? ` · uploaded by ${active.uploadedByName}` : ""}
                  {active.uploadedAt ? ` · ${prettyTime(active.uploadedAt)}` : ""}
                </DialogDescription>
              </DialogHeader>
              <div className="max-h-[min(70vh,640px)] overflow-auto bg-muted/30 p-4">
                {active.contentType?.includes("pdf") || active.viewUrl?.startsWith("data:application/pdf") ? (
                  <iframe
                    title={active.name}
                    src={active.viewUrl}
                    className="h-[min(65vh,600px)] w-full rounded-lg border border-border bg-background"
                  />
                ) : (
                  <img
                    src={active.viewUrl}
                    alt={active.name}
                    className="mx-auto max-h-[min(65vh,600px)] w-auto max-w-full rounded-lg object-contain shadow-sm"
                  />
                )}
              </div>
              <div className="flex items-center justify-end gap-2 border-t border-border/70 px-4 py-3">
                <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setActive(null)}>
                  <X className="h-3.5 w-3.5" /> Close
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => downloadAsset(active)}
                  disabled={!active.viewUrl}
                >
                  <Download className="h-3.5 w-3.5" /> Download
                </Button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
