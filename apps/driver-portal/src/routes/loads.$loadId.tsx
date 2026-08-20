import { useEffect, useState } from "react";
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { ArrowRight, CheckCircle2, FileCheck2, FileWarning, MessageSquare, Phone } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { LocationShareCard } from "@/components/home/location-share-card";
import { DocUploadSheet } from "@/components/loads/doc-upload-sheet";
import { RouteMapPreview } from "@/components/loads/route-map-preview";
import { StatusStepper } from "@/components/loads/status-stepper";
import { useLoads } from "@/lib/loads-store";
import { STATUS_STEPS, type ActiveLoadStatus, type LoadDocument } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/loads/$loadId")({
  component: LoadDetailPage,
});

function LoadDetailPage() {
  const { loadId } = useParams({ from: "/loads/$loadId" });
  const { getLoad, acceptLoad, declineLoad, advanceStatus, markDocumentUploaded } = useLoads();
  const load = getLoad(loadId);
  const [uploadTarget, setUploadTarget] = useState<LoadDocument["type"] | null>(null);

  useEffect(() => {
    document.title = load ? `${load.id} — Titan Freight Driver` : "Load — Titan Freight Driver";
  }, [load]);

  if (!load) {
    return (
      <div className="px-4 py-10 text-center text-sm text-muted-foreground">
        Load {loadId} not found.{" "}
        <Link to="/loads" className="text-primary underline">
          Back to loads
        </Link>
      </div>
    );
  }

  const isOffer = load.status === "offered";
  const isDeclined = load.status === "declined";
  const currentIndex = STATUS_STEPS.findIndex((s) => s.key === load.status);
  const nextStep = !isOffer && !isDeclined ? STATUS_STEPS[currentIndex + 1] : undefined;
  const perMile =
    load.distanceMiles > 0 ? (load.rate / load.distanceMiles).toFixed(2) : "—";

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-500 space-y-4 px-4 py-5">
      <Card className="overflow-hidden border-border/70 shadow-sm">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <Badge variant="secondary">{load.equipment}</Badge>
            <div className="text-right">
              <div className="font-mono text-sm font-semibold text-success">
                ${load.rate.toLocaleString()}
              </div>
              <div className="font-mono text-[11px] text-muted-foreground">
                ${perMile}/mi · {load.distanceMiles} mi
              </div>
            </div>
          </div>

          <div className="mt-4 flex gap-3">
            <div className="flex flex-col items-center pt-1">
              <span className="h-2.5 w-2.5 rounded-full bg-success" />
              <span className="my-1 h-8 w-px border-l border-dashed border-border" />
              <span className="h-2.5 w-2.5 rounded-full bg-destructive" />
            </div>
            <div className="flex-1 space-y-4">
              <div>
                <div className="text-sm font-medium text-foreground">{load.pickup.address}</div>
                <div className="font-mono text-xs text-muted-foreground">{load.pickup.window}</div>
              </div>
              <div>
                <div className="text-sm font-medium text-foreground">{load.delivery.address}</div>
                <div className="font-mono text-xs text-muted-foreground">{load.delivery.window}</div>
              </div>
            </div>
          </div>

          {load.notes ? (
            <>
              <Separator className="my-3" />
              <p className="text-xs text-muted-foreground">{load.notes}</p>
            </>
          ) : null}
        </CardContent>
      </Card>

      <RouteMapPreview progress={isOffer ? 0 : (currentIndex + 1) / STATUS_STEPS.length} />

      {isOffer ? (
        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={() => void declineLoad(load.id)}>
            Decline
          </Button>
          <Button className="flex-1" onClick={() => void acceptLoad(load.id)}>
            Accept load
          </Button>
        </div>
      ) : (
        <Card className="border-border/70 shadow-sm">
          <CardContent className="p-4">
            <h3 className="mb-3 font-heading text-sm font-bold uppercase tracking-wide text-foreground">
              Status
            </h3>
            <StatusStepper status={load.status as ActiveLoadStatus} />
            {nextStep ? (
              <Button
                variant="amber"
                className="w-full gap-1.5"
                onClick={() => void advanceStatus(load.id)}
              >
                Mark as: {nextStep.label} <ArrowRight className="h-4 w-4" />
              </Button>
            ) : (
              <div className="space-y-2">
                <div className="rounded-lg bg-success/10 py-2 text-center text-sm font-medium text-success">
                  Delivered ✓
                </div>
                {(() => {
                  const pod = load.documents.find((d) => d.type === "Proof of Delivery");
                  const bol = load.documents.find((d) => d.type === "Bill of Lading");
                  const needsPod = !pod?.fileName;
                  const needsBol = !bol?.fileName;
                  return (
                    <div
                      className={cn(
                        "rounded-xl border px-3 py-3",
                        needsPod
                          ? "border-amber/40 bg-amber/10"
                          : "border-success/25 bg-success/8",
                      )}
                    >
                      <div className="flex items-start gap-2.5">
                        {needsPod ? (
                          <FileWarning className="mt-0.5 h-4 w-4 shrink-0 text-amber" />
                        ) : (
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-foreground">
                            {needsPod ? "Next: upload Proof of Delivery" : "You're done on this load"}
                          </p>
                          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                            {needsPod
                              ? "Dispatch needs your POD photo to close the load and invoice the customer."
                              : "Dispatch will verify your POD and complete the load. You can still replace docs below if needed."}
                          </p>
                          {needsPod ? (
                            <Button
                              variant="amber"
                              size="sm"
                              className="mt-2.5 w-full gap-1.5"
                              onClick={() => setUploadTarget("Proof of Delivery")}
                            >
                              Upload POD <ArrowRight className="h-3.5 w-3.5" />
                            </Button>
                          ) : needsBol ? (
                            <Button
                              variant="outline"
                              size="sm"
                              className="mt-2.5 w-full gap-1.5"
                              onClick={() => setUploadTarget("Bill of Lading")}
                            >
                              Upload BOL (optional)
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {!isOffer ? (
        <LocationShareCard description={`Sharing your position with dispatch for ${load.id}.`} />
      ) : null}

      <Card className="border-border/70 shadow-sm">
        <CardContent className="space-y-2.5 p-4">
          <h3 className="font-heading text-sm font-bold uppercase tracking-wide text-foreground">
            Documents
          </h3>
          {load.documents.map((doc) => (
            <button
              key={doc.type}
              type="button"
              onClick={() => setUploadTarget(doc.type)}
              className="flex w-full items-center gap-3 rounded-xl border border-border/70 p-3 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {doc.viewUrl && !doc.contentType?.includes("pdf") ? (
                <img
                  src={doc.viewUrl}
                  alt=""
                  className="h-11 w-11 shrink-0 rounded-lg object-cover ring-1 ring-border/70"
                />
              ) : doc.fileName ? (
                <FileCheck2 className="h-5 w-5 shrink-0 text-success" />
              ) : (
                <FileWarning className="h-5 w-5 shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-foreground">{doc.type}</div>
                <div className="truncate font-mono text-xs text-muted-foreground">
                  {doc.fileName ? `${doc.fileName} · ${doc.uploadedAt}` : "Not uploaded yet"}
                </div>
              </div>
              <Badge variant={doc.fileName ? "secondary" : "outline"} className="shrink-0 text-[10px]">
                {doc.fileName ? "Replace" : "Upload"}
              </Badge>
            </button>
          ))}
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 pb-2">
        <Button variant="outline" className="gap-1.5" asChild>
          <a href="tel:+18005551234">
            <Phone className="h-4 w-4" /> Call dispatch
          </a>
        </Button>
        <Button variant="outline" className="gap-1.5" asChild>
          <Link to="/chat">
            <MessageSquare className="h-4 w-4" /> AI Dispatcher
          </Link>
        </Button>
      </div>

      <DocUploadSheet
        open={!!uploadTarget}
        onOpenChange={(open) => !open && setUploadTarget(null)}
        docType={uploadTarget}
        existing={load.documents.find((d) => d.type === uploadTarget) ?? null}
        onUploaded={async (file) => {
          if (uploadTarget) await markDocumentUploaded(load.id, uploadTarget, file);
        }}
      />
    </div>
  );
}
