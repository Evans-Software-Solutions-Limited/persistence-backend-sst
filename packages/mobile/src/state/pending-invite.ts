import { create } from "zustand";

/**
 * usePendingInvite — carries a coach invite `?code=` through the auth flow.
 *
 * When an UNAUTHENTICATED athlete opens an invite deep link
 * (`/(app)/accept-invite?code=X`, e.g. a scanned QR), AuthGate bounces them to
 * sign-in and the query string is lost. This one-shot store stashes the code
 * at that redirect; once a session exists, AuthGate (and the sign-up success
 * handler) send the user to `/(app)/accept-invite?code=X` to redeem, and the
 * accept-invite screen clears the stash on arrival (device-QA #2 follow-up).
 *
 * DELIBERATELY IN-MEMORY (not AsyncStorage). The code is written by a user who
 * is not yet authenticated, so no sign-out clears it — persisting to disk would
 * let a stale code bleed into a DIFFERENT account's next sign-in on a shared
 * device, or resurface days later (Inspector Brad 🟠). Keeping it in memory
 * means an app restart clears it, so the bleed window is only a single
 * continuous app session. Backgrounding during email confirmation preserves
 * in-memory state (only a full process-kill loses it → the user re-enters the
 * code manually, a graceful fallback).
 *
 * Read via `getState().pendingCode` (a PEEK — do NOT clear at the AuthGate
 * consume site: Supabase fires several `onAuthStateChange` events in quick
 * succession, so the redirect effect can re-run before `segments` update; a
 * read-and-clear there would return null on the second run and clobber the
 * accept-invite redirect with the tabs one — Inspector Brad 🟡). The
 * accept-invite screen owns the clear, once it has actually landed.
 */

export interface PendingInviteState {
  /** The stashed invite code, or null when none is pending. */
  pendingCode: string | null;
  setPendingCode: (code: string) => void;
  clearPendingCode: () => void;
  /** Alias for clearPendingCode — called from `useAuth.signOut()`. */
  reset: () => void;
}

export const usePendingInvite = create<PendingInviteState>((set) => ({
  pendingCode: null,
  setPendingCode: (code) => set({ pendingCode: code }),
  clearPendingCode: () => set({ pendingCode: null }),
  reset: () => set({ pendingCode: null }),
}));
