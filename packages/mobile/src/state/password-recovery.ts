import { create } from "zustand";

/**
 * usePasswordRecovery — marks that the current session was established from a
 * password-recovery link, so the user must set a new password before using
 * the app.
 *
 * A recovery deep link (`persistencemobile://auth/callback#…&type=recovery`)
 * is handled by AuthCallbackContainer, which sets this flag *before*
 * establishing the Supabase session. AuthGate then reacts to the new session
 * and — seeing the flag — routes to `/(auth)/set-new-password` instead of the
 * tabs (mirroring how [[pending-invite]] diverts to accept-invite). Routing
 * through AuthGate this way is race-free: whichever of the session update and
 * the container's own navigation lands first, AuthGate reaches the same
 * destination. The set-new-password screen clears the flag once the password
 * is changed.
 *
 * DELIBERATELY IN-MEMORY (not AsyncStorage), same rationale as
 * [[pending-invite]]: it's transient auth-callback intent, and persisting it
 * would risk a stale flag diverting a normal sign-in to set-new-password on a
 * shared device. An app restart clears it — the user just re-requests a reset.
 *
 * Read via `getState().pending` (a PEEK — do NOT clear at the AuthGate consume
 * site: Supabase fires several `onAuthStateChange` events in quick succession,
 * so the redirect effect can re-run before `segments` update; a read-and-clear
 * there would return false on the second run and clobber the redirect. The
 * set-new-password screen owns the clear, once the password is actually set.
 */

export interface PasswordRecoveryState {
  /** True when the live session came from a recovery link and needs a reset. */
  pending: boolean;
  begin: () => void;
  clear: () => void;
  /** Alias for clear — called from `useAuth.signOut()` teardown. */
  reset: () => void;
}

export const usePasswordRecovery = create<PasswordRecoveryState>((set) => ({
  pending: false,
  begin: () => set({ pending: true }),
  clear: () => set({ pending: false }),
  reset: () => set({ pending: false }),
}));
