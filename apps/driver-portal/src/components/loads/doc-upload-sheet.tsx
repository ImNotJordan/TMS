import { useRef, useState } from "react";
import { Camera, CheckCircle2, Eye, FileText, ImageIcon, Upload } from "lucide-react";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import type { LoadDocument } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

export function DocUploadSheet({
  open,
  onOpenChange,
  docType,
  existing,
  onUploaded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  docType: LoadDocument["type"] | null;
  existing?: LoadDocument | null;
  onUploaded: (file: File) => Promise<void>;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [previewName, setPreviewName] = useState<string | null>(null);

  const handleFile = async (file: File | null | undefined) => {
    if (!file || !docType) return;
    setUploading(true);
    setPreviewName(file.name);
    try {
      await onUploaded(file);
      onOpenChange(false);
      setPreviewName(null);
    } catch (err) {
      // Store already toasts; keep sheet open for retry
      setPreviewName(null);
    } finally {
      setUploading(false);
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (uploading) return;
        onOpenChange(next);
        if (!next) setPreviewName(null);
      }}
    >
      <SheetContent side="bottom" className="rounded-t-3xl pb-[max(1rem,env(safe-area-inset-bottom))]">
        <SheetHeader>
          <SheetTitle className="font-heading text-xl font-bold">
            {existing?.fileName ? `Replace ${docType}` : `Upload ${docType}`}
          </SheetTitle>
          <SheetDescription>
            Take a clear photo or choose a file. Dispatch can view it on Tracking → Documents.
          </SheetDescription>
        </SheetHeader>

        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => void handleFile(e.target.files?.[0])}
        />
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf,.pdf"
          className="hidden"
          onChange={(e) => void handleFile(e.target.files?.[0])}
        />

        <div
          className={cn(
            "mt-4 flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-8 text-center transition-colors",
            uploading ? "border-amber/50 bg-amber/5" : "border-border bg-muted/20",
          )}
        >
          {uploading ? (
            <>
              <div className="h-9 w-9 animate-spin rounded-full border-2 border-amber border-t-transparent" />
              <p className="text-sm font-medium text-foreground">Uploading…</p>
              <p className="max-w-[16rem] truncate text-xs text-muted-foreground">
                {previewName ?? "Compressing & saving"}
              </p>
            </>
          ) : existing?.viewUrl ? (
            <>
              <div className="relative overflow-hidden rounded-xl border border-border/70 shadow-sm">
                {existing.contentType?.includes("pdf") ? (
                  <div className="flex h-36 w-52 items-center justify-center bg-card">
                    <FileText className="h-10 w-10 text-muted-foreground" />
                  </div>
                ) : (
                  <img
                    src={existing.viewUrl}
                    alt={existing.fileName ?? docType ?? "Document"}
                    className="h-36 w-52 object-cover"
                  />
                )}
              </div>
              <div className="flex items-center gap-1.5 text-sm font-medium text-success">
                <CheckCircle2 className="h-4 w-4" /> On file
              </div>
              <p className="max-w-[18rem] truncate text-xs text-muted-foreground">
                {existing.fileName}
                {existing.uploadedAt ? ` · ${existing.uploadedAt}` : ""}
              </p>
            </>
          ) : (
            <>
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <ImageIcon className="h-6 w-6" />
              </span>
              <p className="text-sm font-medium text-foreground">Photo or PDF</p>
              <p className="text-xs text-muted-foreground">JPG / PNG preferred · auto-compressed</p>
            </>
          )}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <Button
            variant="outline"
            className="h-12 gap-2"
            disabled={uploading}
            onClick={() => cameraRef.current?.click()}
          >
            <Camera className="h-4 w-4" /> Take photo
          </Button>
          <Button
            variant="amber"
            className="h-12 gap-2"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="h-4 w-4" /> Choose file
          </Button>
        </div>

        {existing?.viewUrl ? (
          <Button
            variant="ghost"
            className="mt-2 w-full gap-2 text-muted-foreground"
            disabled={uploading}
            onClick={() => {
              const w = window.open();
              if (!w) return;
              if (existing.contentType?.includes("pdf")) {
                w.document.write(
                  `<iframe src="${existing.viewUrl}" style="position:fixed;inset:0;width:100%;height:100%;border:0"></iframe>`,
                );
              } else {
                w.document.write(
                  `<img src="${existing.viewUrl}" style="max-width:100%;height:auto;display:block;margin:0 auto" />`,
                );
              }
            }}
          >
            <Eye className="h-4 w-4" /> Preview current file
          </Button>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
