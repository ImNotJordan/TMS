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
  fetchAuthSession,
  fetchUserAttributes,
  getCurrentUser,
  signIn as amplifySignIn,
  signOut as amplifySignOut,
  type FetchUserAttributesOutput,
  type SignInOutput,
} from "aws-amplify/auth";

import { configureAmplify } from "./amplify";

export type ClientProfile = {
  userId: string;
  name: string;
  initials: string;
  email: string;
  attributes: FetchUserAttributesOutput;
  audience: "driver" | "ops" | "client" | "unknown";
};

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

type AuthContextValue = {
  status: AuthStatus;
  client: ClientProfile | null;
  signIn: (email: string, password: string) => Promise<SignInOutput>;
  signOut: () => Promise<void>;
  cancelSignInChallenge: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function initialsFrom(name: string, email: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
  if (parts.length === 1 && parts[0]!.length >= 2) return parts[0]!.slice(0, 2).toUpperCase();
  const local = email.split("@")[0] ?? "CL";
  return local.slice(0, 2).toUpperCase();
}

function resolveAudience(attributes: FetchUserAttributesOutput): ClientProfile["audience"] {
  const raw = [
    attributes["custom:role"],
    attributes["custom:access_level"],
    attributes["custom:userType"],
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (!raw.trim()) return "unknown";
  const isDriver = /\bdriver\b/.test(raw);
  const isClient = /\b(client|customer)\b/.test(raw);
  const isOps =
    /\b(admin|superadmin|dispatcher|broker|ops|operations|manager|shipper|carrier)\b/.test(raw);
  if (isOps) return "ops";
  if (isDriver) return "driver";
  if (isClient) return "client";
  return "unknown";
}

function profileFromAttributes(
  userId: string,
  attributes: FetchUserAttributesOutput,
): ClientProfile {
  const email = attributes.email?.trim() || "";
  const name =
    attributes.name?.trim() ||
    [attributes.given_name, attributes.family_name].filter(Boolean).join(" ").trim() ||
    email.split("@")[0] ||
    "Client";

  return {
    userId,
    name,
    initials: initialsFrom(name, email),
    email,
    attributes,
    audience: resolveAudience(attributes),
  };
}

async function safeLocalSignOut() {
  try {
    await amplifySignOut({ global: false });
  } catch {
    /* ignore */
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [client, setClient] = useState<ClientProfile | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const authGenRef = useRef(0);

  const loadUser = useCallback(async () => {
    const gen = ++authGenRef.current;
    try {
      configureAmplify();
      const session = await fetchAuthSession();
      if (gen !== authGenRef.current) return;
      if (!session.tokens) {
        setClient(null);
        setStatus("unauthenticated");
        return;
      }
      const current = await getCurrentUser();
      if (gen !== authGenRef.current) return;
      const attributes = await fetchUserAttributes();
      if (gen !== authGenRef.current) return;
      setClient(profileFromAttributes(current.userId, attributes));
      setStatus("authenticated");
    } catch {
      if (gen !== authGenRef.current) return;
      setClient(null);
      setStatus("unauthenticated");
    }
  }, []);

  useEffect(() => {
    configureAmplify();
    void loadUser();
  }, [loadUser]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void (async () => {
        try {
          const session = await fetchAuthSession({ forceRefresh: true });
          if (!session.tokens) {
            authGenRef.current += 1;
            setClient(null);
            setStatus("unauthenticated");
            return;
          }
          await loadUser();
        } catch {
          authGenRef.current += 1;
          setClient(null);
          setStatus("unauthenticated");
        }
      })();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [loadUser]);

  const signIn = useCallback<AuthContextValue["signIn"]>(
    async (email, password) => {
      configureAmplify();
      await safeLocalSignOut();
      const username = email.trim().toLowerCase();
      try {
        const result = await amplifySignIn({ username, password });
        if (result.isSignedIn) await loadUser();
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
  }, []);

  const signOut = useCallback(async () => {
    authGenRef.current += 1;
    try {
      await amplifySignOut();
    } finally {
      setClient(null);
      setStatus("unauthenticated");
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      client,
      signIn,
      signOut,
      cancelSignInChallenge,
      refresh: loadUser,
    }),
    [status, client, signIn, signOut, cancelSignInChallenge, loadUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
