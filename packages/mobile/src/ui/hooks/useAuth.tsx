import { useCallback, useEffect, useState } from "react";
import type { AuthSession, OAuthProvider } from "@/domain/ports/auth.port";
import type { AuthError } from "@/shared/errors";
import { useAdapters } from "./useAdapters";

export type AuthState = {
  session: AuthSession | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  error: AuthError | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (
    email: string,
    password: string,
  ) => Promise<{ confirmationRequired: boolean }>;
  signInWithOAuth: (provider: OAuthProvider) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
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
    let bootstrapped = false;

    function finishBootstrap(s: AuthSession | null, err?: AuthError) {
      if (bootstrapped) return;
      bootstrapped = true;
      setSession(s);
      if (err) setError(err);
      setIsLoading(false);
    }

    // Bootstrap: read persisted session. Race against a timeout so a
    // hanging network refresh (expired token + bad connectivity) can
    // never keep the app stuck on the loading spinner.
    auth
      .getSession()
      .then((result) => {
        if (result.ok) {
          finishBootstrap(result.value);
        } else {
          finishBootstrap(null, result.error);
        }
      })
      .catch(() => {
        finishBootstrap(null);
      });

    // Hard timeout — if getSession() hangs (e.g. Supabase trying to
    // refresh an expired token over a slow network), force-resolve
    // loading after 3 seconds so the app remains usable.
    const timeout = setTimeout(() => finishBootstrap(null), 3000);

    // Reactive listener for auth changes after bootstrap (sign-in,
    // sign-out, token refresh). Also picks up INITIAL_SESSION if it
    // fires after subscription (handles the race with getSession).
    const unsubscribe = auth.onAuthStateChange((s) => {
      if (!bootstrapped) {
        finishBootstrap(s);
      } else {
        setSession(s);
        setError(null);
      }
    });

    return () => {
      unsubscribe();
      clearTimeout(timeout);
    };
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

  const signUp = useCallback(
    async (
      email: string,
      password: string,
    ): Promise<{ confirmationRequired: boolean }> => {
      setError(null);
      const result = await auth.signUpWithEmail(email, password);
      if (!result.ok) {
        // email_confirmation_required is a success — user registered,
        // just needs to verify email. Don't treat it as an error.
        if (result.error.code === "email_confirmation_required") {
          return { confirmationRequired: true };
        }
        setError(result.error);
        throw new Error(result.error.message);
      }
      return { confirmationRequired: false };
    },
    [auth],
  );

  const signOut = useCallback(async () => {
    setError(null);
    const result = await auth.signOut();
    if (!result.ok) {
      setError(result.error);
      throw new Error(result.error.message);
    }
  }, [auth]);

  const resetPassword = useCallback(
    async (email: string) => {
      setError(null);
      const result = await auth.resetPassword(email);
      if (!result.ok) {
        setError(result.error);
        throw new Error(result.error.message);
      }
    },
    [auth],
  );

  return {
    session,
    isLoading,
    isAuthenticated: session !== null,
    error,
    signIn,
    signUp,
    signInWithOAuth,
    signOut,
    resetPassword,
  };
}
