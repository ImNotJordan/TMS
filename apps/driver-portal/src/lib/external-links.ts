/**
 * The dispatcher console and driver portal are deployed as two separate
 * AWS Amplify apps. Point these at each app's real domain via env vars
 * once both are deployed — falling back to local dev ports for now.
 */
export const DISPATCH_APP_URL =
  (import.meta.env.VITE_DISPATCH_APP_URL as string | undefined)?.trim() || "http://localhost:5173";
