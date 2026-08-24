import { CheckCircle2, ClipboardCheck, FileWarning, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import * as React from "react";
import { useNavigate } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { completeTrackingLoadAfterPod, type TrackingSession } from "@/lib/tracking-workflow-store";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n/t";

/**
 * Logistics close-out guidance for post-delivery Tracking.
 * Delivered → wait for POD → verify & complete → Accounting invoice.
 */
export function TrackingCloseoutCard({
  session,
  onCompleted,
}: {
  session: TrackingSession;
  onCompleted?: () => void;
}) {
  const navigate = useNavigate();
  const [busy, setBusy] = React.useState(false);
  const pod = session.documents.find((d) => d.type === "POD");
  const hasPodFile = Boolean(pod?.viewUrl) || pod?.status === "Received";

  const goAccounting = (tab: "queues" | "builder" = "builder") => {
    void navigate({
      to: "/accounting",
      search: {
        tab,
        queue: "ready-to-bill",
        loadId: session.loadId,
      },
    });
  };

  if (session.trackingState === "completed") {
    return (
      <div className="rounded-xl border border-success/25 bg-success/10 px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
            <div>
              <p className="text-sm font-semibold text-foreground">{t("Load completed")}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("POD verified. Next: Accounting → Ready to bill → generate invoice.")}
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => goAccounting("builder")}
          >
            {t("Open Accounting")}
          </Button>
        </div>
      </div>
    );
  }

  if (session.trackingState !== "delivered" && session.trackingState !== "pod-uploaded") {
    return null;
  }

  const waitingForPod = session.trackingState === "delivered" && !hasPodFile;

  const onVerify = async () => {
    setBusy(true);
    try {
      await completeTrackingLoadAfterPod(session.loadId, {
        user: "Dispatcher",
      });
      toast.success("Load completed", {
        description: `${session.loadId} closed — open Accounting to invoice.`,
        action: {
          label: "Accounting",
          onClick: () => goAccounting("builder"),
        },
      });
      onCompleted?.();
    } catch (err) {
      toast.error("Could not complete load", {
        description: err instanceof Error ? err.message : "Try again",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={cn(
        "rounded-xl border px-4 py-3",
        waitingForPod ? "border-warning/30 bg-warning/10" : "border-primary/25 bg-primary/8",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {waitingForPod ? (
            <FileWarning className="mt-0.5 h-5 w-5 shrink-0 text-warning-foreground" />
          ) : (
            <ClipboardCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          )}
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">
              {waitingForPod ? "Next: wait for Proof of Delivery" : "Next: verify POD & complete"}
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              {waitingForPod
                ? "Driver marked delivered. Ask them to upload POD from the driver app, then verify it here."
                : "POD is on file. Review the document, complete the load, then invoice from Accounting."}
            </p>
          </div>
        </div>
        {!waitingForPod ? (
          <Button
            size="sm"
            className="gap-1.5 shrink-0"
            disabled={busy}
            onClick={() => void onVerify()}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            Verify POD & complete
          </Button>
        ) : null}
      </div>
    </div>
  );
}
