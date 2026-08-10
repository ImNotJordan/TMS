import { fetchAuthSession } from "aws-amplify/auth";
import {
  AdminCreateUserCommand,
  AdminGetUserCommand,
  AdminResetUserPasswordCommand,
  AdminSetUserPasswordCommand,
  AdminUpdateUserAttributesCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
  type AttributeType,
  type UserType,
} from "@aws-sdk/client-cognito-identity-provider";

import { configureAmplify, hasIdentityPool } from "./amplify";

export type CognitoDirectoryEntry = {
  id: string;
  name?: string;
  email?: string;
  phone?: string;
  department?: string;
  status?: string;
  team?: string;
  lastLogin?: string;
  inviteStatus?: string;
  twoFAStatus?: string;
  createdDate?: string;
  /** Cognito Username (email or UUID) — required for admin APIs. */
  username?: string;
  cognitoStatus?: string;
};

const region =
  (import.meta.env.VITE_AWS_REGION as string | undefined) ??
  (import.meta.env.VITE_COGNITO_REGION as string | undefined);
const userPoolId = import.meta.env.VITE_COGNITO_USER_POOL_ID as string | undefined;

export function isCognitoAdminConfigured() {
  return Boolean(region && userPoolId && hasIdentityPool());
}

let cachedClient: CognitoIdentityProviderClient | null = null;
let cachedExpiry = 0;

/** Drop cached Cognito IDP client (call on sign-out). */
export function clearCognitoIdpClientCache() {
  cachedClient = null;
  cachedExpiry = 0;
}

async function getCognitoIdpClient(): Promise<CognitoIdentityProviderClient> {
  configureAmplify();
  if (!hasIdentityPool()) {
    throw new Error(
      "Cognito Identity Pool is not configured. Set VITE_COGNITO_IDENTITY_POOL_ID in .env.",
    );
  }
  if (!region) {
    throw new Error("Missing VITE_AWS_REGION in .env.");
  }
  if (!userPoolId) {
    throw new Error("Missing VITE_COGNITO_USER_POOL_ID in .env.");
  }

  const now = Date.now();
  if (cachedClient && now < cachedExpiry - 60_000) return cachedClient;

  const session = await fetchAuthSession();
  const credentials = session.credentials;
  if (!credentials) {
    clearCognitoIdpClientCache();
    throw new Error(
      "No AWS credentials. Sign in and ensure the Identity Pool trusts your User Pool.",
    );
  }

  cachedClient = new CognitoIdentityProviderClient({
    region,
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      sessionToken: credentials.sessionToken,
      expiration: credentials.expiration,
    },
  });
  cachedExpiry = credentials.expiration ? credentials.expiration.getTime() : now + 30 * 60_000;
  return cachedClient;
}

function readAttribute(attributes: AttributeType[] | undefined, name: string): string | undefined {
  const value = attributes?.find((attr) => attr.Name === name)?.Value?.trim();
  return value && value.length > 0 ? value : undefined;
}

function synthesizeName({
  givenName,
  familyName,
  nickname,
  email,
  fallbackId,
}: {
  givenName?: string;
  familyName?: string;
  nickname?: string;
  email?: string;
  fallbackId: string;
}): string {
  const full = [givenName, familyName].filter(Boolean).join(" ").trim();
  if (full) return full;
  if (nickname) return nickname;
  if (email) {
    const local = email.split("@")[0];
    if (local) return local;
  }
  return fallbackId;
}

function mapCognitoUserStatus(status: string | undefined): string {
  switch (status) {
    case "CONFIRMED":
      return "Active";
    case "FORCE_CHANGE_PASSWORD":
    case "RESET_REQUIRED":
      return "Pending Invite";
    case "UNCONFIRMED":
      return "Pending Invite";
    case "ARCHIVED":
      return "Deactivated";
    case "COMPROMISED":
    case "DISABLED":
      return "Suspended";
    default:
      return "Active";
  }
}

function mapCognitoInviteStatus(status: string | undefined): string {
  if (status === "FORCE_CHANGE_PASSWORD" || status === "RESET_REQUIRED") return "Sent";
  if (status === "UNCONFIRMED") return "Sent";
  if (status === "CONFIRMED") return "Accepted";
  return "Not Sent";
}

function mapCognitoUserToEntry(user: UserType): CognitoDirectoryEntry | null {
  const attrs = user.Attributes;
  const sub = readAttribute(attrs, "sub");
  if (!sub) return null;

  const email = readAttribute(attrs, "email");
  const givenName = readAttribute(attrs, "given_name");
  const familyName = readAttribute(attrs, "family_name");
  const nickname = readAttribute(attrs, "nickname");

  return {
    id: sub,
    name: synthesizeName({
      givenName,
      familyName,
      nickname,
      email,
      fallbackId: sub,
    }),
    email,
    phone: readAttribute(attrs, "phone_number"),
    department: readAttribute(attrs, "custom:department"),
    status: mapCognitoUserStatus(user.UserStatus),
    inviteStatus: mapCognitoInviteStatus(user.UserStatus),
    createdDate: user.UserCreateDate?.toISOString(),
    username: user.Username,
    cognitoStatus: user.UserStatus,
  };
}

export function describeCognitoAdminError(err: unknown, op: string): Error {
  if (err && typeof err === "object") {
    const e = err as { name?: string; message?: string };
    if (e.name === "UsernameExistsException" || e.name === "AliasExistsException") {
      return new Error("A user with this email already exists in Cognito.");
    }
    if (e.name === "InvalidPasswordException") {
      return new Error(
        e.message ??
          "Temporary password does not meet the user pool password policy. Use at least 12 characters with upper, lower, number, and symbol.",
      );
    }
    if (e.name === "InvalidParameterException") {
      if ((e.message ?? "").toLowerCase().includes("username should be an email")) {
        return new Error(
          "Username should be an email. This user pool signs in with email — reset now uses the account email attribute.",
        );
      }
      return new Error(e.message ?? "Invalid user details for Cognito.");
    }
    if (
      e.name === "AccessDeniedException" ||
      e.name === "NotAuthorizedException" ||
      e.name === "UnauthorizedException"
    ) {
      return new Error(
        `Not authorized for Cognito ${op}. Add cognito-idp:${op}, AdminUpdateUserAttributes, and ListUsers to your Identity Pool authenticated IAM role.`,
      );
    }
    const detail = [e.name, e.message].filter(Boolean).join(" · ");
    if (detail) return new Error(`Cognito ${op} failed: ${detail}`);
  }
  return new Error(`Cognito ${op} failed`);
}

function generateTemporaryPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  let value = "Tf";
  for (let i = 0; i < 14; i += 1) {
    value += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `${value}1a`;
}

function normalizePhoneE164(phone: string | undefined): string | undefined {
  if (!phone?.trim()) return undefined;
  const digits = phone.replace(/\D/g, "");
  if (!digits) return undefined;
  if (phone.trim().startsWith("+")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

function isEmailAliasUsernameError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const message = String((err as { message?: string }).message ?? "").toLowerCase();
  return message.includes("email") && message.includes("alias");
}

function newCognitoUsername(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `user_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
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

/** Lists users from the Cognito User Pool (preferred over DynamoDB table scan). */
export async function listCognitoDirectoryUsers(): Promise<CognitoDirectoryEntry[]> {
  if (!isCognitoAdminConfigured()) {
    throw new Error(
      "Cognito admin is not configured. Set VITE_COGNITO_USER_POOL_ID and VITE_COGNITO_IDENTITY_POOL_ID.",
    );
  }

  const client = await getCognitoIdpClient();
  const users: CognitoDirectoryEntry[] = [];
  let paginationToken: string | undefined;

  try {
    do {
      const out = await client.send(
        new ListUsersCommand({
          UserPoolId: userPoolId,
          PaginationToken: paginationToken,
          Limit: 60,
        }),
      );

      for (const user of out.Users ?? []) {
        const entry = mapCognitoUserToEntry(user);
        if (entry) users.push(entry);
      }

      paginationToken = out.PaginationToken;
    } while (paginationToken);
  } catch (err) {
    throw describeCognitoAdminError(err, "ListUsers");
  }

  return users;
}

async function sendAdminCreateUser(
  client: CognitoIdentityProviderClient,
  input: {
    username: string;
    email: string;
    userAttributes: AttributeType[];
    temporaryPassword: string;
    sendInvite: boolean;
  },
) {
  return client.send(
    new AdminCreateUserCommand({
      UserPoolId: userPoolId,
      Username: input.username,
      UserAttributes: input.userAttributes,
      TemporaryPassword: input.temporaryPassword,
      DesiredDeliveryMediums: input.sendInvite ? ["EMAIL"] : undefined,
      MessageAction: input.sendInvite ? undefined : "SUPPRESS",
    }),
  );
}

/** Creates a user in the Cognito User Pool (admin API). Returns the user's `sub`. */
export async function adminCreateCognitoUser(
  input: AdminCreateCognitoUserInput,
): Promise<AdminCreateCognitoUserResult> {
  if (!isCognitoAdminConfigured()) {
    throw new Error(
      "Cognito admin is not configured. Set VITE_COGNITO_USER_POOL_ID and VITE_COGNITO_IDENTITY_POOL_ID.",
    );
  }

  const email = input.email.trim().toLowerCase();
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  if (!email || !firstName || !lastName) {
    throw new Error("Email, first name, and last name are required for Cognito.");
  }

  const userAttributes: AttributeType[] = [
    { Name: "email", Value: email },
    { Name: "given_name", Value: firstName },
    { Name: "family_name", Value: lastName },
  ];

  const nickname = input.displayName?.trim();
  if (nickname) userAttributes.push({ Name: "nickname", Value: nickname });

  const phone = normalizePhoneE164(input.phone);
  if (phone) userAttributes.push({ Name: "phone_number", Value: phone });

  const temporaryPassword = input.temporaryPassword?.trim() || generateTemporaryPassword();
  const sendInvite = Boolean(input.sendEmailInvite);

  try {
    const client = await getCognitoIdpClient();
    let out;

    try {
      out = await sendAdminCreateUser(client, {
        username: email,
        email,
        userAttributes,
        temporaryPassword,
        sendInvite,
      });
    } catch (firstErr) {
      if (!isEmailAliasUsernameError(firstErr)) throw firstErr;
      out = await sendAdminCreateUser(client, {
        username: newCognitoUsername(),
        email,
        userAttributes,
        temporaryPassword,
        sendInvite,
      });
    }

    const sub = readAttribute(out.User?.Attributes, "sub");
    if (!sub) {
      throw new Error("Cognito user was created but no sub attribute was returned.");
    }

    return {
      userId: sub,
      username: out.User?.Username ?? email,
    };
  } catch (err) {
    throw describeCognitoAdminError(err, "AdminCreateUser");
  }
}

function sanitizeCognitoFilterValue(value: string): string {
  return value.trim().replace(/"/g, "");
}

function isEmailLike(value: string | undefined): boolean {
  if (!value) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/**
 * Cognito pools configured with email-as-username reject non-email `Username`
 * values ("Username should be an email"). Prefer the email attribute / alias.
 */
function cognitoAdminUsername(resolved: ResolvedCognitoUser, fallbackEmail?: string): string {
  if (isEmailLike(resolved.username)) {
    return resolved.username.trim().toLowerCase();
  }
  const email = (resolved.email || fallbackEmail || "").trim().toLowerCase();
  if (isEmailLike(email)) return email;
  return resolved.username;
}

function isUsernameMustBeEmailError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const message = String((err as { message?: string }).message ?? "").toLowerCase();
  return message.includes("username should be an email");
}

export type ResolvedCognitoUser = {
  username: string;
  userStatus?: string;
  email?: string;
  sub?: string;
};

/** Resolve Cognito Username from directory `sub` and/or email. */
export async function resolveCognitoUsername(input: {
  userId?: string;
  email?: string;
}): Promise<ResolvedCognitoUser> {
  if (!isCognitoAdminConfigured()) {
    throw new Error(
      "Cognito admin is not configured. Set VITE_COGNITO_USER_POOL_ID and VITE_COGNITO_IDENTITY_POOL_ID.",
    );
  }

  const client = await getCognitoIdpClient();
  const email = input.email ? sanitizeCognitoFilterValue(input.email.toLowerCase()) : "";
  const userId = input.userId ? sanitizeCognitoFilterValue(input.userId) : "";

  const tryFilter = async (filter: string): Promise<ResolvedCognitoUser | null> => {
    const out = await client.send(
      new ListUsersCommand({
        UserPoolId: userPoolId,
        Filter: filter,
        Limit: 1,
      }),
    );
    const user = out.Users?.[0];
    if (!user?.Username) return null;
    return {
      username: user.Username,
      userStatus: user.UserStatus,
      email: readAttribute(user.Attributes, "email") ?? (isEmailLike(email) ? email : undefined),
      sub: readAttribute(user.Attributes, "sub"),
    };
  };

  try {
    if (email) {
      const byEmail = await tryFilter(`email = "${email}"`);
      if (byEmail) return byEmail;
    }
    if (userId) {
      const bySub = await tryFilter(`sub = "${userId}"`);
      if (bySub) return bySub;
    }
  } catch (err) {
    throw describeCognitoAdminError(err, "ListUsers");
  }

  throw new Error("User not found in Cognito. Confirm the email matches the User Pool account.");
}

export type AdminResetPasswordResult = {
  username: string;
  /** Present when admin set/resends a temporary password (not used for email-reset-code). */
  temporaryPassword?: string;
  /** True when Cognito was asked to deliver email (reset code or invite). */
  emailed: boolean;
  method: "email-reset-code" | "resend-invite" | "set-temporary-password";
  previousStatus?: string;
  destinationHint?: string;
};

async function ensureEmailVerifiedForDelivery(
  client: CognitoIdentityProviderClient,
  username: string,
  email: string,
) {
  try {
    await client.send(
      new AdminUpdateUserAttributesCommand({
        UserPoolId: userPoolId,
        Username: username,
        UserAttributes: [
          { Name: "email", Value: email },
          { Name: "email_verified", Value: "true" },
        ],
      }),
    );
  } catch (err) {
    console.warn("[cognito] Could not mark email verified before reset email", err);
  }
}

/**
 * Admin password reset that prefers emailing the user via Cognito.
 *
 * - CONFIRMED → AdminResetUserPassword (forgot-password code emailed)
 * - FORCE_CHANGE_PASSWORD / expired invite → AdminCreateUser RESEND (temp password emailed)
 * - Last resort → AdminSetUserPassword (admin must share temp password manually)
 */
export async function adminResetCognitoPassword(input: {
  userId?: string;
  email?: string;
  /** When true (default), Cognito emails a reset code or invite. */
  sendEmail?: boolean;
  temporaryPassword?: string;
}): Promise<AdminResetPasswordResult> {
  if (!isCognitoAdminConfigured()) {
    throw new Error(
      "Cognito admin is not configured. Set VITE_COGNITO_USER_POOL_ID and VITE_COGNITO_IDENTITY_POOL_ID.",
    );
  }

  const resolved = await resolveCognitoUsername({
    userId: input.userId,
    email: input.email,
  });
  const apiUsername = cognitoAdminUsername(resolved, input.email);
  const email = (resolved.email || input.email || "").trim().toLowerCase();
  if (!isEmailLike(apiUsername) && !isEmailLike(email)) {
    throw new Error(
      "This Cognito user pool requires an email username, but no email was found for this account.",
    );
  }

  const usernameForApi = isEmailLike(apiUsername) ? apiUsername : email;
  const temporaryPassword = input.temporaryPassword?.trim() || generateTemporaryPassword();
  const sendEmail = input.sendEmail !== false;
  const client = await getCognitoIdpClient();

  let userStatus = resolved.userStatus;
  try {
    const got = await client.send(
      new AdminGetUserCommand({
        UserPoolId: userPoolId,
        Username: usernameForApi,
      }),
    );
    userStatus = got.UserStatus ?? userStatus;
  } catch {
    if (resolved.username !== usernameForApi) {
      try {
        const got = await client.send(
          new AdminGetUserCommand({
            UserPoolId: userPoolId,
            Username: resolved.username,
          }),
        );
        userStatus = got.UserStatus ?? userStatus;
      } catch {
        /* keep list status */
      }
    }
  }

  if (sendEmail && isEmailLike(email)) {
    await ensureEmailVerifiedForDelivery(client, usernameForApi, email);
  }

  const needsInviteResend =
    userStatus === "FORCE_CHANGE_PASSWORD" ||
    userStatus === "RESET_REQUIRED" ||
    userStatus === "UNCONFIRMED";

  const sendResetCodeEmail = async (): Promise<AdminResetPasswordResult> => {
    await client.send(
      new AdminResetUserPasswordCommand({
        UserPoolId: userPoolId,
        Username: usernameForApi,
      }),
    );
    return {
      username: usernameForApi,
      emailed: true,
      method: "email-reset-code",
      previousStatus: userStatus,
      destinationHint: email || usernameForApi,
    };
  };

  const resendInviteEmail = async (): Promise<AdminResetPasswordResult> => {
    await client.send(
      new AdminCreateUserCommand({
        UserPoolId: userPoolId,
        Username: usernameForApi,
        TemporaryPassword: temporaryPassword,
        MessageAction: "RESEND",
        DesiredDeliveryMediums: ["EMAIL"],
      }),
    );
    return {
      username: usernameForApi,
      temporaryPassword,
      emailed: true,
      method: "resend-invite",
      previousStatus: userStatus,
      destinationHint: email || usernameForApi,
    };
  };

  const setTemporaryPasswordManual = async (): Promise<AdminResetPasswordResult> => {
    await client.send(
      new AdminSetUserPasswordCommand({
        UserPoolId: userPoolId,
        Username: usernameForApi,
        Password: temporaryPassword,
        Permanent: false,
      }),
    );
    return {
      username: usernameForApi,
      temporaryPassword,
      emailed: false,
      method: "set-temporary-password",
      previousStatus: userStatus,
      destinationHint: email || usernameForApi,
    };
  };

  if (!sendEmail) {
    return setTemporaryPasswordManual();
  }

  // Invite / expired-temp accounts: Cognito invitation email with a new temp password.
  if (needsInviteResend) {
    try {
      return await resendInviteEmail();
    } catch (resendErr) {
      console.warn("[cognito] RESEND invite email failed; trying reset-code email", resendErr);
      try {
        return await sendResetCodeEmail();
      } catch (resetErr) {
        console.warn(
          "[cognito] Reset-code email failed; falling back to manual temp password",
          resetErr,
        );
        try {
          return await setTemporaryPasswordManual();
        } catch {
          throw describeCognitoAdminError(resendErr, "AdminCreateUser");
        }
      }
    }
  }

  // Confirmed users: standard Cognito forgot-password email (verification code).
  try {
    return await sendResetCodeEmail();
  } catch (resetErr) {
    console.warn("[cognito] AdminResetUserPassword failed; trying invite RESEND", resetErr);
    try {
      return await resendInviteEmail();
    } catch (resendErr) {
      console.warn("[cognito] RESEND failed; falling back to manual temp password", resendErr);
      try {
        return await setTemporaryPasswordManual();
      } catch {
        throw describeCognitoAdminError(resetErr, "AdminResetUserPassword");
      }
    }
  }
}

/** Resend Cognito invite / refresh expired temporary password window (emails when possible). */
export async function adminResendCognitoInvite(input: {
  userId?: string;
  email?: string;
  temporaryPassword?: string;
}): Promise<AdminResetPasswordResult> {
  return adminResetCognitoPassword({
    ...input,
    sendEmail: true,
  });
}
