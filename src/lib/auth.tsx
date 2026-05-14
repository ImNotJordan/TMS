import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
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

export type AuthUser = {
  username: string;
  userId: string;
  email?: string;
  name?: string;
  attributes: FetchUserAttributesOutput;
};

type AuthContextValue = {
  user: AuthUser | null;
  status: "loading" | "authenticated" | "unauthenticated";
  signIn: (email: string, password: string) => Promise<SignInOutput>;
  signOut: () => Promise<void>;
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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthContextValue["status"]>("loading");

  const loadUser = useCallback(async () => {
    try {
      configureAmplify();
      const session = await fetchAuthSession();
      if (!session.tokens) {
        setUser(null);
        setStatus("unauthenticated");
        return;
      }
      const current = await getCurrentUser();
      const attributes = await fetchUserAttributes();
      setUser({
        username: current.username,
        userId: current.userId,
        email: attributes.email,
        name: attributes.name ?? attributes.given_name,
        attributes,
      });
      setStatus("authenticated");
    } catch {
      setUser(null);
      setStatus("unauthenticated");
    }
  }, []);

  useEffect(() => {
    configureAmplify();
    void loadUser();
  }, [loadUser]);

  const signIn = useCallback<AuthContextValue["signIn"]>(async (email, password) => {
    configureAmplify();
    const result = await amplifySignIn({ username: email, password });
    if (result.isSignedIn) {
      await loadUser();
    }
    return result;
  }, [loadUser]);

  const signOut = useCallback(async () => {
    await amplifySignOut();
    setUser(null);
    setStatus("unauthenticated");
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
