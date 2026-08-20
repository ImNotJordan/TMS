import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  confirmUserAttribute,
  fetchAuthSession,
  fetchUserAttributes,
  getCurrentUser,
  sendUserAttributeVerificationCode,
  signIn as amplifySignIn,
  signOut as amplifySignOut,
  updateUserAttributes,
  type FetchUserAttributesOutput,
  type SignInOutput,
  type UpdateUserAttributesOutput,
  type VerifiableUserAttributeKey,
} from "aws-amplify/auth";

import { configureAmplify } from "./amplify";
import { clearAdminAuditLogsCache } from "./admin-audit-store";
import { clearAdminDirectoryCache } from "./admin-users-cache";
import { clearCognitoIdpClientCache } from "./cognito-admin";
import { clearDynamoClientCache } from "./dynamodb";
import {
  clearOperationalDataCache,
  setOperationalCacheScope,
} from "./operational-data-cache";
import {
  clearIntegrationsConfigCache,
  ensureIntegrationsConfigLoaded,
} from "./integrations-config";
import { clearProfileSectionCache } from "./profile-section-cache";
import { clearTrackingSyncVersions } from "./tracking-workflow-store";
import { resolveAppAudience } from "./auth-roles";

export type AuthUser = {
  username: string;
  userId: string;
  email?: string;
  name?: string;
  attributes: FetchUserAttributesOutput;
  /** Epoch seconds of the most recent authentication (from Cognito idToken `auth_time`). */
  authTime?: number;
  /** Epoch seconds of token issuance (from Cognito idToken `iat`). */
  issuedAt?: number;
  /** Soft app audience from Cognito attributes (driver | ops | unknown). */
  audience: "driver" | "ops" | "unknown";
};

type AuthContextValue = {
  user: AuthUser | null;
  status: "loading" | "authenticated" | "unauthenticated";
  signIn: (email: string, password: string) => Promise<SignInOutput>;
  signOut: () => Promise<void>;
  /** Clears an incomplete Cognito challenge without navigating. */
  cancelSignInChallenge: () => Promise<void>;
  refresh: () => Promise<void>;
  updateAttributes: (
    attributes: Record<string, string | undefined>,
  ) => Promise<UpdateUserAttributesOutput>;
  resendAttributeCode: (key: VerifiableUserAttributeKey) => Promise<void>;
  confirmAttribute: (
    key: VerifiableUserAttributeKey,
    code: string,
  ) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function clearLocalAuthCaches(previousUserId?: string) {
  clearDynamoClientCache();
  clearCognitoIdpClientCache();
  clearProfileSectionCache(previousUserId);
  clearIntegrationsConfigCache();
  clearOperationalDataCache(previousUserId);
  clearAdminDirectoryCache(previousUserId);
  clearAdminAuditLogsCache();
  clearTrackingSyncVersions();
  setOperationalCacheScope(null);
}

async function safeLocalSignOut() {
  try {
    await amplifySignOut({ global: false });
  } catch {
    /* already signed out / interrupted challenge */
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthContextValue["status"]>("loading");
  const userIdRef = useRef<string | undefined>(undefined);
  const authGenRef = useRef(0);
  userIdRef.current = user?.userId;

  const loadUser = useCallback(async () => {
    const gen = ++authGenRef.current;
    try {
      configureAmplify();
      const session = await fetchAuthSession();
      if (gen !== authGenRef.current) return;
      if (!session.tokens) {
        setOperationalCacheScope(null);
        setUser(null);
        setStatus("unauthenticated");
        return;
      }
      const current = await getCurrentUser();
      if (gen !== authGenRef.current) return;
      const attributes = await fetchUserAttributes();
      if (gen !== authGenRef.current) return;
      const payload = session.tokens?.idToken?.payload as
        | { auth_time?: number; iat?: number }
        | undefined;
      setUser({
        username: current.username,
        userId: current.userId,
        email: attributes.email,
        name: attributes.name ?? attributes.given_name,
        attributes,
        authTime: payload?.auth_time,
        issuedAt: payload?.iat,
        audience: resolveAppAudience(attributes as Record<string, string | undefined>),
      });
      setOperationalCacheScope(current.userId);
      setStatus("authenticated");
      void ensureIntegrationsConfigLoaded();
    } catch {
      if (gen !== authGenRef.current) return;
      setOperationalCacheScope(null);
      setUser(null);
      setStatus("unauthenticated");
    }
  }, []);

  useEffect(() => {
    configureAmplify();
    void loadUser();
  }, [loadUser]);

  // Revalidate session when the tab becomes visible again (expired refresh tokens).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void (async () => {
        try {
          const session = await fetchAuthSession({ forceRefresh: true });
          if (!session.tokens) {
            const previousUserId = userIdRef.current;
            authGenRef.current += 1;
            clearLocalAuthCaches(previousUserId);
            setUser(null);
            setStatus("unauthenticated");
            return;
          }
          await loadUser();
        } catch {
          const previousUserId = userIdRef.current;
          authGenRef.current += 1;
          clearLocalAuthCaches(previousUserId);
          setUser(null);
          setStatus("unauthenticated");
        }
      })();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [loadUser]);

  const signIn = useCallback<AuthContextValue["signIn"]>(async (email, password) => {
    configureAmplify();
    // Clear any incomplete NEW_PASSWORD / MFA challenge from a prior attempt.
    await safeLocalSignOut();
    clearDynamoClientCache();
    clearCognitoIdpClientCache();
    const username = email.trim().toLowerCase();
    try {
      const result = await amplifySignIn({ username, password });
      if (result.isSignedIn) {
        await loadUser();
      }
      return result;
    } catch (err) {
      const name = err && typeof err === "object" ? (err as { name?: string }).name : undefined;
      if (name === "UserAlreadyAuthenticatedException") {
        await safeLocalSignOut();
        const result = await amplifySignIn({ username, password });
        if (result.isSignedIn) await loadUser();
        return result;
      }
      throw err;
    }
  }, [loadUser]);

  const cancelSignInChallenge = useCallback(async () => {
    await safeLocalSignOut();
    clearDynamoClientCache();
    clearCognitoIdpClientCache();
  }, []);

  const signOut = useCallback(async () => {
    const previousUserId = userIdRef.current;
    authGenRef.current += 1;
    try {
      await amplifySignOut();
    } finally {
      clearLocalAuthCaches(previousUserId);
      setUser(null);
      setStatus("unauthenticated");
    }
  }, []);

  const updateAttributes = useCallback<AuthContextValue["updateAttributes"]>(
    async (attributes) => {
      configureAmplify();
      const cleaned: Record<string, string> = {};
      for (const [key, value] of Object.entries(attributes)) {
        if (value === undefined) continue;
        const trimmed = value.trim();
        if (trimmed.length === 0) continue;
        cleaned[key] = trimmed;
      }
      const result = await updateUserAttributes({ userAttributes: cleaned });
      await loadUser();
      return result;
    },
    [loadUser],
  );

  const resendAttributeCode = useCallback<AuthContextValue["resendAttributeCode"]>(
    async (key) => {
      configureAmplify();
      await sendUserAttributeVerificationCode({ userAttributeKey: key });
    },
    [],
  );

  const confirmAttribute = useCallback<AuthContextValue["confirmAttribute"]>(
    async (key, code) => {
      configureAmplify();
      await confirmUserAttribute({ userAttributeKey: key, confirmationCode: code });
      await loadUser();
    },
    [loadUser],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      status,
      signIn,
      signOut,
      cancelSignInChallenge,
      refresh: loadUser,
      updateAttributes,
      resendAttributeCode,
      confirmAttribute,
    }),
    [
      user,
      status,
      signIn,
      signOut,
      cancelSignInChallenge,
      loadUser,
      updateAttributes,
      resendAttributeCode,
      confirmAttribute,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
