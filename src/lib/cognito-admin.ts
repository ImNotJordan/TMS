/**
 * Cognito administration, from the browser.
 *
 * ## Transport
 *
 * `/api/admin/user-credentials`. The browser holds no Cognito admin permissions
 * at all, and must not: `AdminUpdateUserAttributes` is an IAM-authenticated API
 * that ignores the app client's "custom:companyId is read-only" setting, so
 * holding it let any signed-in user rewrite their own company claim and read
 * every tenant's data. It was the single worst finding in the audit.
 *
 * The logic these calls reach is the same code as before — it moved to
 * `cognito-admin-core.ts` unchanged and now runs under the server principal.
 *
 * Exported names and signatures are unchanged so no screen moved.
 */
import { fetchAuthSession } from "aws-amplify/auth";

import { hasIdentityPool } from "./amplify";

export type { CognitoDirectoryEntry } from "./cognito-admin-core";

const PATH = "/api/admin/user-credentials";

/**
 * Whether account administration is available.
 *
 * Now a question about the session rather than about local AWS configuration:
 * the server owns the pool credentials, and the browser only needs to be able
 * to authenticate its request.
 */
export function isCognitoAdminConfigured() {
  return hasIdentityPool();
}

/** Retained for the sign-out path; there is no longer a client to discard. */
export function clearCognitoIdpClientCache() {
  /* no cached admin client exists in the browser any more */
}

async function post<T>(payload: Record<string, unknown>, op: string): Promise<T> {
  let headers: Record<string, string> = {};
  try {
    const session = await fetchAuthSession();
    const token = session.tokens?.idToken?.toString();
    if (token) headers = { Authorization: `Bearer ${token}` };
  } catch {
    /* unauthenticated — the server will say so */
  }

  const response = await fetch(PATH, {
    method: "POST",
    headers: { Accept: "application/json", "content-type": "application/json", ...headers },
    body: JSON.stringify(payload),
  });

  const body = (await response.json().catch(() => null)) as ({ error?: string } & T) | null;
  if (!response.ok) {
    throw new Error(body?.error ?? `${op} failed (HTTP ${response.status}).`);
  }
  return body as T;
}

export type AdminCreateCognitoUserInput = {
  email: string;
  firstName: string;
  lastName: string;
  displayName?: string;
  phone?: string;
  department?: string;
  jobTitle?: string;
  temporaryPassword?: string;
  /** When true, Cognito emails the temporary password / invite. */
  sendEmailInvite?: boolean;
};

export type AdminCreateCognitoUserResult = {
  userId: string;
  username: string;
};

export type AdminResetPasswordResult = {
  username: string;
  /** Present when the admin must share a temporary password manually. */
  temporaryPassword?: string;
  /** True when Cognito was asked to deliver email (reset code or invite). */
  emailed: boolean;
  method: "email-reset-code" | "resend-invite" | "set-temporary-password";
  previousStatus?: string;
  destinationHint?: string;
};

export async function adminCreateCognitoUser(
  input: AdminCreateCognitoUserInput,
): Promise<AdminCreateCognitoUserResult> {
  return post<AdminCreateCognitoUserResult>({ action: "create", ...input }, "Create user");
}

export async function adminResetCognitoPassword(input: {
  userId?: string;
  email?: string;
  sendEmail?: boolean;
  temporaryPassword?: string;
}): Promise<AdminResetPasswordResult> {
  return post<AdminResetPasswordResult>({ action: "reset-password", ...input }, "Password reset");
}

export async function adminResendCognitoInvite(input: {
  userId?: string;
  email?: string;
  temporaryPassword?: string;
}): Promise<AdminResetPasswordResult> {
  return post<AdminResetPasswordResult>({ action: "resend-invite", ...input }, "Resend invite");
}
