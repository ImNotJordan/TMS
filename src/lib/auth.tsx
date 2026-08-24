import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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

import { useQueryClient, type QueryClient } from "@tanstack/react-query";

import { configureAmplify } from "./amplify";
import { cacheScopeOf, shouldPurgeForScopeChange } from "./auth-cache-scope";
import { clearAdminAuditLogsCache } from "./admin-audit-store";
import { clearAdminDirectoryCache } from "./admin-users-cache";
import { clearCognitoIdpClientCache } from "./cognito-admin";
import { clearDynamoClientCache } from "./dynamodb";
import { clearOperationalDataCache, setOperationalCacheScope } from "./operational-data-cache";
import {
  clearAiConnectionStatusCache,
  clearIntegrationsConfigCache,
  ensureAiConnectionStatus,
  ensureIntegrationsConfigLoaded,
} from "./integrations-config";
import { clearAppSettingsCache } from "./app-settings-store";
import { clearProfileSectionCache } from "./profile-section-cache";
import { clearTrackingSyncVersions } from "./tracking-workflow-store";
import { clearBiddingWorkspaceCache } from "./bidding-workspace-store";
import { clearAllBiddingPageCaches } from "./bidding-page-cache";
import { resolveAppAudience } from "./auth-roles";
import {
  clearCompanyContext,
  ensureCompanyContext,
  setCompanyContextUser,
} from "./tenant/company-context";

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
  audience: "driver" | "ops" | "client" | "unknown";
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
  confirmAttribute: (key: VerifiableUserAttributeKey, code: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Drop every client-side cache that could hold another identity's data.
 *
 * @param queryClient The React Query cache. Optional only so the function stays
 *   callable before the provider exists; when omitted, React Query survives and
 *   that is a leak — pass it.
 */
function clearLocalAuthCaches(previousUserId?: string, queryClient?: QueryClient) {
  // React Query first, and wholesale.
  //
  // Most keys here are unscoped — ["loads"], ["carriers"], ["quotes"],
  // ["truckboard"], ["sidebar","operational-counts"] — and the QueryClient is
  // created once per page load, so it outlives sign-out. Without this, signing
  // in as a second user in the same tab serves the first user's rows from cache
  // while the refetch is still in flight.
  //
  // Cleared entirely rather than key-by-key on purpose: a list of keys to purge
  // is a list somebody has to remember to extend, and the one they forget is the
  // leak. Everything is refetched from an endpoint that scopes by token anyway.
  queryClient?.clear();

  clearCompanyContext();
  clearAiConnectionStatusCache();
  clearDynamoClientCache();
  clearCognitoIdpClientCache();
  clearProfileSectionCache(previousUserId);
  clearIntegrationsConfigCache();
  clearAppSettingsCache();
  clearOperationalDataCache(previousUserId);
  clearAdminDirectoryCache(previousUserId);
  clearAdminAuditLogsCache();
  clearTrackingSyncVersions();
  // Quotes, buy rates and margins, held in sessionStorage. Signing out without
  // dropping these leaves one user's commercial data readable by the next
  // person to sign in on the same browser.
  clearBiddingWorkspaceCache();
  // The search cache is a second copy of the same commercial data — lane
  // pricing, buy rates, margins — under its own storage prefix.
  clearAllBiddingPageCaches();
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

  // AuthProvider renders inside QueryClientProvider (see __root.tsx), so this
  // is the same client every screen reads through.
  const queryClient = useQueryClient();
  // `userId:companyId` as of the last successful load. A change means the
  // cached data belongs to somebody else — or to this user's previous company.
  const cacheScopeRef = useRef<string | null>(null);

  const loadUser = useCallback(async () => {
    const gen = ++authGenRef.current;
    try {
      configureAmplify();
      const session = await fetchAuthSession();
      if (gen !== authGenRef.current) return;
      if (!session.tokens) {
        clearLocalAuthCaches(userIdRef.current, queryClient);
        cacheScopeRef.current = null;
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

      // Resolve the assigned company before any store reads, and fold it into
      // the cache scope so a reassignment can never surface the previous
      // company's cached rows to the same user.
      setCompanyContextUser(current.userId);
      const company = await ensureCompanyContext();
      if (gen !== authGenRef.current) return;

      const scope = cacheScopeOf(current.userId, company?.companyId);
      // The central transition check. A different user, or the same user
      // reassigned to a different company, must not read the previous scope's
      // cached rows. Doing it here rather than in signIn/signOut means every
      // path that reaches an authenticated state is covered — including token
      // refresh on tab focus, which is not an obvious place to remember.
      if (shouldPurgeForScopeChange(cacheScopeRef.current, scope)) {
        clearLocalAuthCaches(userIdRef.current, queryClient);
        // Re-bind: the purge above cleared the company context we just resolved.
        setCompanyContextUser(current.userId);
      }
      cacheScopeRef.current = scope;
      setOperationalCacheScope(scope);
      setStatus("authenticated");
      void ensureIntegrationsConfigLoaded();
      // Whether an OpenAI key exists is a server-side fact now — fetch it once
      // per session so AI surfaces know if they are available.
      void ensureAiConnectionStatus({ force: true });
    } catch {
      if (gen !== authGenRef.current) return;
      // Failing to establish a session is a transition to unauthenticated, so it
      // purges like one. Leaving the cache intact here would keep the previous
      // user's data live behind a failed refresh.
      clearLocalAuthCaches(userIdRef.current, queryClient);
      cacheScopeRef.current = null;
      setUser(null);
      setStatus("unauthenticated");
    }
  }, [queryClient]);

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
            clearLocalAuthCaches(previousUserId, queryClient);
            cacheScopeRef.current = null;
            setUser(null);
            setStatus("unauthenticated");
            return;
          }
          await loadUser();
        } catch {
          const previousUserId = userIdRef.current;
          authGenRef.current += 1;
          clearLocalAuthCaches(previousUserId, queryClient);
          cacheScopeRef.current = null;
          setUser(null);
          setStatus("unauthenticated");
        }
      })();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [loadUser, queryClient]);

  const signIn = useCallback<AuthContextValue["signIn"]>(
    async (email, password) => {
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
    },
    [loadUser],
  );

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
      // In the `finally` so a failed network sign-out still purges locally —
      // otherwise a user who clicks sign out on a flaky connection stays signed
      // out visually with their data still cached.
      clearLocalAuthCaches(previousUserId, queryClient);
      cacheScopeRef.current = null;
      setUser(null);
      setStatus("unauthenticated");
    }
  }, [queryClient]);

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

  const resendAttributeCode = useCallback<AuthContextValue["resendAttributeCode"]>(async (key) => {
    configureAmplify();
    await sendUserAttributeVerificationCode({ userAttributeKey: key });
  }, []);

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
