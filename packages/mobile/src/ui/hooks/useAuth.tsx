import { useCallback, useEffect, useState } from "react";
import type { AuthSession, OAuthProvider } from "@/domain/ports/auth.port";
import { fail, type AuthError, type Result } from "@/shared/errors";
import { useUserMode } from "@/state/user-mode";
import { useTrainSegment } from "@/ui/hooks/useTrainSegment";
import { useCoachLibrarySegment } from "@/ui/hooks/useCoachLibrarySegment";
import { usePendingInvite } from "@/state/pending-invite";
import { usePasswordRecovery } from "@/state/password-recovery";
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
  ) => Promise<{ confirmationRequired: boolean; mayAlreadyExist: boolean }>;
  signInWithOAuth: (provider: OAuthProvider) => Promise<void>;
  signInWithApple: () => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  /**
   * Change the signed-in user's password (set-new-password screen, after a
   * recovery link established the session). Throws on failure so the caller
   * can surface an inline error.
   */
  updatePassword: (newPassword: string) => Promise<void>;
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
    // The on-device session, read with no network. Populated as soon as the
    // fast local read resolves; the timeout and getSession-failure paths fall
    // back to it so an offline launch keeps the user signed in (offline-first)
    // instead of bouncing them to sign-in.
    let persisted: AuthSession | null = null;

    function finishBootstrap(s: AuthSession | null, err?: AuthError) {
      if (bootstrapped) return;
      bootstrapped = true;
      setSession(s);
      if (err) setError(err);
      setIsLoading(false);
    }

    // Offline-first: read the persisted session straight from device storage
    // (no network). `getPersistedSession` is optional on the port (a
    // lightweight adapter may omit it); when absent, fall back to the
    // getSession()-only bootstrap. Normalised to never reject so the two reads
    // below can be coordinated without a rejection racing the decision.
    const persistedRead: Promise<AuthSession | null> = (
      auth.getPersistedSession
        ? auth.getPersistedSession()
        : Promise.resolve<AuthSession | null>(null)
    ).catch(() => null);

    // If a stored session lands first, resolve the bootstrap with it
    // immediately — the app renders from the local cache without waiting on a
    // token refresh that may hang or fail with no connectivity.
    void persistedRead.then((s) => {
      persisted = s;
      if (s) finishBootstrap(s);
    });

    // Live session — may hit the network to refresh an expired access token.
    // Normalised to never reject (offline refresh failure → a failed Result).
    const liveRead = auth.getSession().then(
      (result) => result,
      (): Result<AuthSession | null, AuthError> =>
        fail({
          kind: "auth",
          code: "token_expired",
          message: "getSession failed",
        }),
    );

    // Authoritative decision — combine BOTH reads. The signed-out conclusion
    // requires that getSession produced no session AND there is no persisted
    // session; it must never fire on a getSession() failure ALONE, because the
    // two reads race and a network-failure that lands before the (slower)
    // on-device read would otherwise bounce a valid offline user to sign-in
    // (Inspector Brad 🟠). A fresh session from getSession() always wins.
    void Promise.all([liveRead, persistedRead]).then(
      ([result, persistedSession]) => {
        if (result.ok && result.value) {
          // Online / refreshed session is authoritative. Adopt it whether or
          // not we already bootstrapped from the persisted session.
          if (!bootstrapped) finishBootstrap(result.value);
          else {
            setSession(result.value);
            setError(null);
          }
        } else if (!bootstrapped) {
          // No live session. Fall back to the on-device one if present;
          // only conclude signed-out when there is genuinely nothing stored.
          finishBootstrap(
            persistedSession,
            persistedSession || result.ok ? undefined : result.error,
          );
        }
      },
    );

    // Hard timeout — if BOTH reads hang (e.g. Supabase refreshing an expired
    // token over a dead network AND the local read stalling), force-resolve
    // loading after 3 seconds so the app is never stuck on the spinner. Uses
    // the persisted session if the local read has landed by then.
    const timeout = setTimeout(() => finishBootstrap(persisted), 3000);

    // Reactive listener for auth changes after bootstrap (sign-in, sign-out,
    // token refresh). Also picks up INITIAL_SESSION if it fires after
    // subscription (handles the race with getSession).
    //
    // ⚠ Offline-first invariant: a `null` session is honoured ONLY when the
    // event is `SIGNED_OUT`. Supabase emits `INITIAL_SESSION`/refresh events
    // carrying `null` when it can't refresh an expired token offline — but it
    // leaves the stored session in place and retries, so treating that
    // transient null as a sign-out is exactly the bug that logs the user out
    // abroad. Keep the last good session until a genuine `SIGNED_OUT` (real
    // sign-out, or a server-confirmed revocation) arrives.
    const unsubscribe = auth.onAuthStateChange((s, event) => {
      // Ignore a null session ONLY when we positively know the event is a
      // non-sign-out one (Supabase's offline INITIAL_SESSION/refresh). An
      // `undefined` event (a lightweight adapter that emits without a name)
      // is treated as authoritative, preserving the older single-arg contract
      // where a `null` meant "signed out".
      if (s === null && event != null && event !== "SIGNED_OUT") {
        return;
      }
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
    ): Promise<{ confirmationRequired: boolean; mayAlreadyExist: boolean }> => {
      setError(null);
      const result = await auth.signUpWithEmail(email, password);
      if (!result.ok) {
        // Neither of these is an error. `email_confirmation_required` means the
        // user registered and needs to verify. `email_may_already_exist` means
        // Supabase silently did nothing because the address is already taken —
        // also not a failure to surface as a red banner, but the user must be
        // told to sign in rather than wait for an email that will never come.
        // It is a HINT ONLY (see the adapter): it must never gate registration,
        // which is why it resolves rather than throws.
        if (result.error.code === "email_confirmation_required") {
          return { confirmationRequired: true, mayAlreadyExist: false };
        }
        if (result.error.code === "email_may_already_exist") {
          return { confirmationRequired: true, mayAlreadyExist: true };
        }
        setError(result.error);
        throw new Error(result.error.message);
      }
      return { confirmationRequired: false, mayAlreadyExist: false };
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
    usePasswordRecovery.getState().reset();
  }, [storage]);

  const signOut = useCallback(async () => {
    setError(null);
    const result = await auth.signOut();
    if (!result.ok) {
      // The remote revoke failed — almost always a network partition, which is
      // itself a common cause of a stuck/offline app (e.g. the Home-error
      // "Sign out" escape hatch). The user asked to sign out, so we must NOT
      // leave them signed in locally, or the escape hatch re-strands them.
      // Tear down local state anyway; the adapter has already dropped the
      // on-device token (local-scope fallback in `signOut`), so `AuthGate`
      // redirects to sign-in. Still surface + throw the error for callers that
      // display it (ProfileContainer / RestoreAccount).
      clearLocalState();
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

  const updatePassword = useCallback(
    async (newPassword: string) => {
      setError(null);
      const result = await auth.updatePassword(newPassword);
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
    updatePassword,
    deleteAccount,
  };
}
