/**
 * The dispatcher console and driver portal (apps/driver-portal) are deployed
 * as two separate AWS Amplify apps. Point this at the driver app's real
 * domain via an env var once it's deployed — falling back to its local dev
 * port for now.
 */
export const DRIVER_APP_URL =
  (import.meta.env.VITE_DRIVER_APP_URL as string | undefined)?.trim() || "http://localhost:5174";
