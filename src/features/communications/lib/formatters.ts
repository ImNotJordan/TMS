import type { ChannelId } from "../types";

export function formatRelativeTime(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diffMs = now - then;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 4) return "••••";
  return `+• ••• ••• ${digits.slice(-4)}`;
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, "0")}`;
}

export function truncatePreview(text: string, max = 80): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1)}…`;
}

export const CHANNEL_LABELS: Record<ChannelId, string> = {
  email: "Email",
  sms: "SMS",
  voice: "Voice",
  chat: "Chat",
};

export function languageDisplayName(bcp47: string): string {
  try {
    const display = new Intl.DisplayNames(["en"], { type: "language" });
    const base = bcp47.split("-")[0] ?? bcp47;
    return display.of(base) ?? bcp47;
  } catch {
    return bcp47;
  }
}
