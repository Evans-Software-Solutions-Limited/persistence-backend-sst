import { useCallback, useEffect, useState } from "react";
import type { AuthSession, OAuthProvider } from "@/domain/ports/auth.port";
import type { AuthError } from "@/shared/errors";
import { useAdapters } from "./useAdapters";

export type AuthState = {
  session: AuthSession | null;
  isLoading: boolean;
  error: AuthError | null;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithOAuth: (provider: OAuthProvider) => Promise<void>;
  signOut: () => Promise<void>;
};

/**
 * Hook for auth state management. Wraps the AuthPort adapter
 * to provide reactive session state and auth actions.
 */
export function useAuth(): AuthState {
  const { auth } = useAdapters();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<AuthError | null>(null);

  useEffect(() => {
    // Bootstrap: get existing session
    auth
      .getSession()
      .then((result) => {
        if (result.ok) {
          setSession(result.value);
        } else {
          setError(result.error);
        }
      })
      .catch((err) => {
        console.error("[useAuth] getSession failed:", err);
      })
      .finally(() => {
        setIsLoading(false);
      });

    // Listen for auth changes
    const unsubscribe = auth.onAuthStateChange((s) => {
      setSession(s);
      setError(null);
    });

    return unsubscribe;
  }, [auth]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      setError(null);
      const result = await auth.signInWithEmail(email, password);
      if (!result.ok) {
        setError(result.error);
        throw new Error(result.error.message);
      }
    },
    [auth],
  );

  const signInWithOAuth = useCallback(
    async (provider: OAuthProvider) => {
      setError(null);
      const result = await auth.signInWithOAuth(provider);
      if (!result.ok) {
        setError(result.error);
        throw new Error(result.error.message);
      }
    },
    [auth],
  );

  const signOut = useCallback(async () => {
    const result = await auth.signOut();
    if (!result.ok) {
      setError(result.error);
      throw new Error(result.error.message);
    }
  }, [auth]);

  return { session, isLoading, error, signIn, signInWithOAuth, signOut };
}
