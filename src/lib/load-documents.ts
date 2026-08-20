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
  dataUrl: string;
};

export function labelForKind(kind: LoadDocumentKind): string {
  return kind === "bol" ? "Bill of Lading" : "Proof of Delivery";
}

export function trackingTypeForKind(kind: LoadDocumentKind): "BOL" | "POD" {
  return kind === "bol" ? "BOL" : "POD";
}

export function findAssetByKind(
  assets: LoadDocumentAsset[] | undefined,
  kind: LoadDocumentKind,
): LoadDocumentAsset | undefined {
  return (assets ?? []).find((a) => a.kind === kind);
}

/** Build tracking-panel docs from load assets + legacy string tags. */
export function trackingDocumentsFromLoad(input: {
  loadId: string;
  documentAssets?: LoadDocumentAsset[];
  documents?: string[];
  updatedAt?: string;
}): Array<{
  id: string;
  name: string;
  type: "BOL" | "POD" | "Photo" | "Rate Conf." | "Lumper" | "Other";
  status: "Pending" | "Received" | "Required";
  uploadedAt?: string;
  contentType?: string;
  viewUrl?: string;
  uploadedByName?: string;
  size?: number;
}> {
  const assets = input.documentAssets ?? [];
  const byKind = new Map(assets.map((a) => [a.kind, a]));

  const bolAsset = byKind.get("bol");
  const podAsset = byKind.get("pod");
  const legacy = input.documents ?? [];
  const legacyBol = legacy.find((d) => d.startsWith("bol:"));
  const legacyPod = legacy.find((d) => d.startsWith("pod:"));

  const bolName = bolAsset?.fileName ?? (legacyBol ? legacyBol.slice(4) : "Bill of lading");
  const podName = podAsset?.fileName ?? (legacyPod ? legacyPod.slice(4) : "Proof of delivery");

  return [
    {
      id: bolAsset?.id ?? `${input.loadId}-bol`,
      name: bolName,
      type: "BOL",
      status: bolAsset || legacyBol ? "Received" : "Pending",
      uploadedAt: bolAsset?.uploadedAt ?? (legacyBol ? input.updatedAt : undefined),
      contentType: bolAsset?.contentType,
      viewUrl: bolAsset?.dataUrl,
      uploadedByName: bolAsset?.uploadedByName,
      size: bolAsset?.size,
    },
    {
      id: podAsset?.id ?? `${input.loadId}-pod`,
      name: podName,
      type: "POD",
      status: podAsset || legacyPod ? "Received" : "Required",
      uploadedAt: podAsset?.uploadedAt ?? (legacyPod ? input.updatedAt : undefined),
      contentType: podAsset?.contentType,
      viewUrl: podAsset?.dataUrl,
      uploadedByName: podAsset?.uploadedByName,
      size: podAsset?.size,
    },
  ];
}

export function formatBytes(size?: number): string {
  if (size == null || !Number.isFinite(size)) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
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
