import { useCallback, useEffect, useState } from "react";
import type { AuthSession, OAuthProvider } from "@/domain/ports/auth.port";
import type { AuthError } from "@/shared/errors";
import { useUserMode } from "@/state/user-mode";
import { useTrainSegment } from "@/ui/hooks/useTrainSegment";
import { useCoachLibrarySegment } from "@/ui/hooks/useCoachLibrarySegment";
import { usePendingInvite } from "@/state/pending-invite";
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
  signInWithApple: () => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  /**
   * Cluster 2b: returns the backend's `purgeAfter` so the caller can show
   * the grace-period date after signing the user out.
   */
  deleteAccount: () => Promise<{ purgeAfter: string }>;
};

/**
 * Hook for auth state management. Wraps the AuthPort adapter
 * to provide reactive session state and auth actions.
 */
export function useAuth(): AuthState {
  const { auth, storage, api } = useAdapters();
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

  const signInWithApple = useCallback(async () => {
    setError(null);
    const result = await auth.signInWithApple();
    if (!result.ok) {
      // Cancellation is a user dismissing the native sheet — treat it as
      // a silent no-op (no error banner, no throw).
      if (result.error.code === "cancelled") return;
      setError(result.error);
      throw new Error(result.error.message);
    }
  }, [auth]);

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

  // Shared local-session teardown for both sign-out and account deletion.
  // Clears cached user data (sync queue, exercises, metadata) so the next
  // sign-in starts clean, and resets the device-global runtime slices.
  // The user-mode + train-segment + coach-library-segment STORAGE_KEYs are
  // device-global (not user-scoped), so without this a trainer's coach mode /
  // last segment / pending create-exercise redirect would bleed into the next
  // account on this device (PR #93 review). In-memory resets are synchronous;
  // the disk clears inside them + storage.clearAll() are best-effort.
  const clearLocalState = useCallback(() => {
    try {
      storage.clearAll();
    } catch {
      // Best-effort — don't block teardown on storage failure.
    }
    useUserMode.getState().reset();
    useTrainSegment.getState().reset();
    useCoachLibrarySegment.getState().reset();
    usePendingInvite.getState().reset();
  }, [storage]);

  const signOut = useCallback(async () => {
    setError(null);
    const result = await auth.signOut();
    if (!result.ok) {
      setError(result.error);
      throw new Error(result.error.message);
    }
    clearLocalState();
  }, [auth, clearLocalState]);

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

  // App Store Guideline 5.1.1(v): schedule the account for deletion.
  // Cluster 2b revised the backend from an immediate cascade-purge to a
  // 30-day soft-delete grace period, but the local-teardown contract is
  // unchanged: on success, tear down the session same as sign-out; on
  // failure leave the user signed in so they can retry (the endpoint is
  // idempotent). Navigation to the sign-in screen is handled by AuthGate
  // reacting to the session→null change, same as sign-out. The backend
  // delete goes through the SST API (not Supabase directly) per the
  // repo's "all business data through the API" rule.
  //
  // Returns the backend's `purgeAfter` so callers (PrivacySettingsContainer)
  // can surface the grace-period date after the sign-out completes.
  const deleteAccount = useCallback(async (): Promise<{
    purgeAfter: string;
  }> => {
    setError(null);
    const result = await api.deleteAccount();
    if (!result.ok) {
      const err: AuthError = {
        kind: "auth",
        code: "unknown",
        message: result.error.message,
      };
      setError(err);
      throw new Error(result.error.message);
    }
    // Account is soft-deleted server-side. Clear the local Supabase session
    // (best-effort — a subsequent sign-in during the grace period routes
    // through the restore-account gate instead) + local state.
    await auth.signOut().catch(() => undefined);
    clearLocalState();
    return { purgeAfter: result.value.purgeAfter };
  }, [api, auth, clearLocalState]);

  return {
    session,
    isLoading,
    isAuthenticated: session !== null,
    error,
    signIn,
    signUp,
    signInWithOAuth,
    signInWithApple,
    signOut,
    resetPassword,
    deleteAccount,
  };
}
