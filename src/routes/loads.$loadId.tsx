import * as React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowLeft, Loader2, Package, Save, Truck, X } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { GlobalLoader } from "@/components/global-loader";
import {
  LOAD_FORM_STEPS,
  StepAssignment,
  StepBasic,
  StepDocsTracking,
  StepFreight,
  StepPricing,
  StepReview,
  StepStops,
  computeLoadWizardStepErrors,
  loadDraftToRecord,
  recordToLoadDraft,
  type LoadDraft,
} from "@/components/loads/create-load-dialog";
import { getLoadById, updateLoad, type LoadRecord } from "@/lib/loads-store";
import {
  normalizeLoadForDriverAssignment,
  syncTrackingSessionForLoad,
} from "@/lib/tracking-workflow-store";

export const Route = createFileRoute("/loads/$loadId")({
  head: ({ params }) => ({
    meta: [
      { title: `${params.loadId} — Edit load` },
      { name: "description", content: "View and edit load details." },
    ],
  }),
  component: LoadDetailPage,
});

function EditLoadSection({
  stepNum,
  meta,
  sectionRefs,
  children,
  className,
}: {
  stepNum: number;
  meta: (typeof LOAD_FORM_STEPS)[number];
  sectionRefs: React.MutableRefObject<Record<number, HTMLElement | null>>;
  children: React.ReactNode;
  /** Full-width on large screens — use for very tall sections so the sibling column isn’t blank. */
  className?: string;
}) {
  const Icon = meta.icon;
  return (
    <section
      ref={(el) => {
        sectionRefs.current[stepNum] = el;
      }}
      className={cn(
        "scroll-mt-28 rounded-xl border border-border/60 bg-card/35 p-4 shadow-sm backdrop-blur-[2px] sm:p-5 [&>div]:mx-0 [&>div]:max-w-none",
        className,
      )}
    >
      <div className="mb-3 flex items-start gap-2.5 border-b border-border/50 pb-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 pt-px">
          <h2 className="text-sm font-semibold tracking-tight text-foreground">{meta.label}</h2>
          <p className="text-xs leading-snug text-muted-foreground">{meta.description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function LoadDetailPage() {
  const { loadId } = Route.useParams();
  const [baseline, setBaseline] = React.useState<LoadRecord | null>(null);
  const [draft, setDraft] = React.useState<LoadDraft | null>(null);
  const [fetchState, setFetchState] = React.useState<"loading" | "error" | "ready" | "missing">(
    "loading",
  );
  const [fetchError, setFetchError] = React.useState<string | null>(null);

  const [showValidationErrors, setShowValidationErrors] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [dirty, setDirty] = React.useState(false);

  const sectionRefs = React.useRef<Record<number, HTMLElement | null>>({});

  const scrollToSection = React.useCallback((stepId: number) => {
    sectionRefs.current[stepId]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    setFetchState("loading");
    setFetchError(null);
    setBaseline(null);
    setDraft(null);
    setDirty(false);
    setShowValidationErrors(false);
    setSaveError(null);
    void (async () => {
      try {
        const item = await getLoadById(loadId);
        if (cancelled) return;
        if (!item) {
          setFetchState("missing");
          return;
        }
        setBaseline(item);
        setDraft(recordToLoadDraft(item));
        setFetchState("ready");
      } catch (err) {
        if (cancelled) return;
        setFetchError(err instanceof Error ? err.message : "Failed to load.");
        setFetchState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadId]);

  const update = React.useCallback(<K extends keyof LoadDraft>(key: K, value: LoadDraft[K]) => {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
    setDirty(true);
    setSaveError(null);
  }, []);

  const stepErrors = React.useMemo(
    () =>
      draft
        ? computeLoadWizardStepErrors(draft)
        : { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] },
    [draft],
  );

  const blockingSteps = [1, 2, 3, 4, 5].filter((s) => stepErrors[s].length > 0);
  const canSave = Boolean(draft && baseline && blockingSteps.length === 0);

  const handleDiscard = () => {
    if (!baseline) return;
    setDraft(recordToLoadDraft(baseline));
    setDirty(false);
    setSaveError(null);
    setShowValidationErrors(false);
    toast.message("Reverted to last saved version.");
  };

  const handleSave = async () => {
    if (!draft || !baseline) return;
    setShowValidationErrors(true);
    if (blockingSteps.length > 0) {
      toast.error("Fix required fields before saving.", {
        description: `Incomplete sections: ${blockingSteps.map((s) => LOAD_FORM_STEPS[s - 1].label).join(", ")}`,
      });
      scrollToSection(blockingSteps[0]);
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const payload = normalizeLoadForDriverAssignment(loadDraftToRecord(draft, baseline));
      const saved = await updateLoad(payload);
      syncTrackingSessionForLoad(saved, "Dispatcher");
      setBaseline(saved);
      setDraft(recordToLoadDraft(saved));
      setDirty(false);
      setShowValidationErrors(false);
      toast.success("Load saved", { description: `${saved.loadId} synced to DynamoDB.` });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Save failed.";
      setSaveError(message);
      toast.error("Could not save load", { description: message });
    } finally {
      setSaving(false);
    }
  };

  const footerStatus = (() => {
    if (saveError) {
      return (
        <span className="inline-flex max-w-full items-center gap-1 truncate rounded-md bg-destructive/12 px-2 py-1 font-medium text-destructive">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          <span className="truncate" title={saveError}>
            {saveError}
          </span>
        </span>
      );
    }
    if (showValidationErrors && blockingSteps.length > 0) {
      return (
        <span className="inline-flex items-center gap-1 rounded-md bg-destructive/12 px-2 py-1 font-medium text-destructive">
          <AlertTriangle className="h-3 w-3" />
          {blockingSteps.length} section{blockingSteps.length === 1 ? "" : "s"} need required fields
        </span>
      );
    }
    if (dirty) {
      return (
        <span className="inline-flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
          Unsaved edits
        </span>
      );
    }
  })();

  if (fetchState === "loading") {
    return <GlobalLoader variant="embedded" message={`Opening load ${loadId}…`} />;
  }

  if (fetchState === "error") {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <div className="rounded-xl border border-destructive/30 bg-destructive/8 p-6 text-sm text-destructive">
          <div className="font-semibold">Could not load this shipment</div>
          <p className="mt-2 text-xs opacity-90">{fetchError}</p>
          <Button className="mt-4" variant="outline" asChild>
            <Link to="/loads">Back to loads</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (fetchState === "missing" || !draft || !baseline) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-20 text-center">
        <Package className="h-12 w-12 text-muted-foreground" />
        <div>
          <h1 className="text-lg font-semibold text-foreground">Load not found</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            No DynamoDB item for <span className="font-mono">{loadId}</span>.
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link to="/loads">Back to loads</Link>
        </Button>
      </div>
    );
  }

  const reviewMeta = LOAD_FORM_STEPS[6];
  const ReviewIcon = reviewMeta.icon;

  return (
    <div className="min-h-[calc(100dvh-4rem)] pb-10 pt-4">
      <div className="mx-auto max-w-[1400px] px-4 sm:px-6">
        {/* Sticky toolbar */}
        <div className="sticky top-0 z-20 -mx-px mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-border/70 bg-background/95 px-1 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="flex min-w-0 items-center gap-3">
            <Button variant="ghost" size="icon" className="shrink-0" asChild>
              <Link to="/loads" aria-label="Back to loads">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Truck className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-lg font-semibold tracking-tight text-foreground">
                  Edit load
                </h1>
                <p className="truncate text-xs text-muted-foreground">
                  {draft.loadId}
                  {dirty ? " · Unsaved changes" : " · Saved"}
                </p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {dirty && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleDiscard}
                className="text-muted-foreground"
              >
                <X className="mr-1 h-4 w-4" /> Discard
              </Button>
            )}
            <Button type="button" variant="outline" size="sm" asChild>
              <Link to="/loads">Close</Link>
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!dirty || !canSave || saving}
              onClick={() => void handleSave()}
              className="bg-gradient-to-r from-success to-primary text-primary-foreground shadow-sm shadow-success/25 hover:opacity-95 disabled:opacity-40"
            >
              {saving ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" /> Saving…
                </>
              ) : (
                <>
                  <Save className="mr-1 h-4 w-4" /> Save changes
                </>
              )}
            </Button>
          </div>
        </div>

        <div className="space-y-5 pb-8">
          <section
            ref={(el) => {
              sectionRefs.current[7] = el;
            }}
            className="scroll-mt-28 rounded-xl border border-border/60 bg-card/35 p-4 shadow-sm backdrop-blur-[2px] sm:p-5 [&>div]:mx-0 [&>div]:max-w-none"
          >
            <div className="mb-3 flex items-start gap-2.5 border-b border-border/50 pb-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
                <ReviewIcon className="h-4 w-4" />
              </span>
              <div className="min-w-0 pt-px">
                <h2 className="text-sm font-semibold tracking-tight text-foreground">
                  {reviewMeta.label}
                </h2>
                <p className="text-xs leading-snug text-muted-foreground">
                  {reviewMeta.description}
                </p>
              </div>
            </div>
            <StepReview
              draft={draft}
              stepErrors={stepErrors}
              onJump={scrollToSection}
              variant="edit"
            />
          </section>

          {/*
            Pickup & delivery is always much taller than freight/docs headers — keep it full-width
            on lg+ so we never get a tall empty column beside it. Docs uses full width for the same reason.
          */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-5 lg:items-start">
            <EditLoadSection stepNum={1} meta={LOAD_FORM_STEPS[0]} sectionRefs={sectionRefs}>
              <StepBasic
                draft={draft}
                update={update}
                touched={showValidationErrors}
                errors={stepErrors[1]}
                immutableLoadId
              />
            </EditLoadSection>

            <EditLoadSection stepNum={4} meta={LOAD_FORM_STEPS[3]} sectionRefs={sectionRefs}>
              <StepPricing
                draft={draft}
                update={update}
                touched={showValidationErrors}
                errors={stepErrors[4]}
              />
            </EditLoadSection>

            <EditLoadSection
              stepNum={2}
              meta={LOAD_FORM_STEPS[1]}
              sectionRefs={sectionRefs}
              className="lg:col-span-2"
            >
              <StepStops
                draft={draft}
                update={update}
                touched={showValidationErrors}
                errors={stepErrors[2]}
              />
            </EditLoadSection>

            <EditLoadSection stepNum={3} meta={LOAD_FORM_STEPS[2]} sectionRefs={sectionRefs}>
              <StepFreight
                draft={draft}
                update={update}
                touched={showValidationErrors}
                errors={stepErrors[3]}
              />
            </EditLoadSection>

            <EditLoadSection stepNum={5} meta={LOAD_FORM_STEPS[4]} sectionRefs={sectionRefs}>
              <StepAssignment
                draft={draft}
                update={update}
                touched={showValidationErrors}
                errors={stepErrors[5]}
              />
            </EditLoadSection>

            <EditLoadSection
              stepNum={6}
              meta={LOAD_FORM_STEPS[5]}
              sectionRefs={sectionRefs}
              className="lg:col-span-2"
            >
              <StepDocsTracking draft={draft} update={update} />
            </EditLoadSection>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="sticky bottom-0 z-10 mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-border/70 bg-background/95 px-1 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="flex min-w-0 flex-1 items-center gap-2 text-xs text-muted-foreground">
            {footerStatus}
          </div>
        </div>
      </div>
    </div>
  );
}
