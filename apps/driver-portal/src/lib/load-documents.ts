export type LoadDocumentKind = "bol" | "pod";

export type LoadDocumentAsset = {
  id: string;
  kind: LoadDocumentKind;
  fileName: string;
  contentType: string;
  size: number;
  uploadedAt: string;
  uploadedBy?: string;
  uploadedByName?: string;
  /** Inline payload for preview (compressed data URL). */
  dataUrl: string;
};

export const MAX_DOCUMENT_BYTES = 280_000;
export const MAX_IMAGE_EDGE = 1280;
export const IMAGE_QUALITY = 0.72;

export function kindFromDocType(type: "Bill of Lading" | "Proof of Delivery"): LoadDocumentKind {
  return type === "Bill of Lading" ? "bol" : "pod";
}

export function labelForKind(kind: LoadDocumentKind): string {
  return kind === "bol" ? "Bill of Lading" : "Proof of Delivery";
}

export function trackingTypeForKind(kind: LoadDocumentKind): "BOL" | "POD" {
  return kind === "bol" ? "BOL" : "POD";
}

export function createDocumentId(kind: LoadDocumentKind) {
  return `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not decode image"));
    img.src = dataUrl;
  });
}

async function compressImageFile(file: File): Promise<{
  dataUrl: string;
  contentType: string;
  size: number;
  fileName: string;
  originalName: string;
}> {
  const original = await readFileAsDataUrl(file);
  const img = await loadImage(original);
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.drawImage(img, 0, 0, width, height);

  let quality = IMAGE_QUALITY;
  let dataUrl = canvas.toDataURL("image/jpeg", quality);
  while (dataUrl.length > MAX_DOCUMENT_BYTES && quality > 0.4) {
    quality -= 0.08;
    dataUrl = canvas.toDataURL("image/jpeg", quality);
  }
  if (dataUrl.length > MAX_DOCUMENT_BYTES) {
    throw new Error("Photo is still too large after compression. Try a closer, clearer shot.");
  }

  const base = file.name.replace(/\.[^.]+$/, "") || "photo";
  return {
    dataUrl,
    contentType: "image/jpeg",
    size: Math.round((dataUrl.length * 3) / 4),
    fileName: `${base}.jpg`,
    originalName: file.name,
  };
}

/**
 * Prepare a camera/file pick for Dynamo-backed storage (compressed images, small PDFs).
 */
export async function prepareLoadDocumentFile(file: File): Promise<{
  dataUrl: string;
  contentType: string;
  size: number;
  fileName: string;
  originalName: string;
}> {
  const type = (file.type || "").toLowerCase();
  if (type.startsWith("image/")) {
    return compressImageFile(file);
  }
  if (type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    if (file.size > MAX_DOCUMENT_BYTES) {
      throw new Error("PDF must be under ~280KB for in-app storage. Upload a photo of the page instead.");
    }
    const dataUrl = await readFileAsDataUrl(file);
    if (dataUrl.length > MAX_DOCUMENT_BYTES) {
      throw new Error("PDF is too large after encoding. Upload a photo instead.");
    }
    return {
      dataUrl,
      contentType: "application/pdf",
      size: file.size,
      fileName: file.name.toLowerCase().endsWith(".pdf") ? file.name : `${file.name}.pdf`,
      originalName: file.name,
    };
  }
  throw new Error("Use a JPG, PNG, HEIC/photo, or small PDF.");
}

/** Camera rolls often produce UUID / image.jpg names — normalize for chat + docs. */
export function friendlyDocumentFileName(input: {
  kind: LoadDocumentKind;
  contentType: string;
  originalName?: string;
  uploadedAt?: string;
}): string {
  const original = (input.originalName ?? "").trim();
  const base = original.replace(/\.[^.]+$/, "");
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(base);
  const isGeneric = /^(image|photo|blob|capture|img_?\d*|screenshot.*|pxl_.*|dsc_?\d*)$/i.test(base);
  const ext = input.contentType.includes("pdf") || /\.pdf$/i.test(original) ? "pdf" : "jpg";
  if (original && !isUuid && !isGeneric) {
    return /\.[^.]+$/.test(original) ? original : `${original}.${ext}`;
  }
  const when = input.uploadedAt ? new Date(input.uploadedAt) : new Date();
  const stamp = Number.isNaN(when.getTime())
    ? "upload"
    : when
        .toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
        .replace(/,/g, "")
        .replace(/\s+/g, "-");
  const label = input.kind === "pod" ? "POD" : "BOL";
  return `${label}-${stamp}.${ext}`;
}

export function upsertDocumentAsset(
  existing: LoadDocumentAsset[] | undefined,
  next: LoadDocumentAsset,
): LoadDocumentAsset[] {
  const list = [...(existing ?? [])].filter((d) => d.kind !== next.kind);
  list.push(next);
  return list;
}

export function documentTagsFromAssets(assets: LoadDocumentAsset[] | undefined): string[] {
  return (assets ?? []).map((a) => `${a.kind}:${a.fileName}`);
}

export function findAssetByKind(
  assets: LoadDocumentAsset[] | undefined,
  kind: LoadDocumentKind,
): LoadDocumentAsset | undefined {
  return (assets ?? []).find((a) => a.kind === kind);
}
