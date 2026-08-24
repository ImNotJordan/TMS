export const DISPATCH_APP_URL =
  (import.meta.env.VITE_DISPATCH_APP_URL as string | undefined)?.trim() || "http://localhost:5173";

export const DRIVER_APP_URL =
  (import.meta.env.VITE_DRIVER_APP_URL as string | undefined)?.trim() || "http://localhost:5174";
