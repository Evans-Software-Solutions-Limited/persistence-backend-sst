import { create } from "zustand";

/**
 * usePendingTogetherJoin — carries a Together join link through sign-in
 * (PER-60, canvas row 1 "Cold start from QR").
 *
 * A QR scanned with the app closed opens `/(app)/together/join?...` through
 * the OS. When nobody is signed in, AuthGate bounces to sign-in and the query
 * would be lost; this one-shot store stashes it at that redirect, AuthGate
 * sends the signed-in user back to the join screen, and the join screen
 * clears it once it has landed. The same pattern as `usePendingInvite`.
 *
 * In memory only, for the same reason as the coach invite stash: the link is
 * written by someone who is not yet signed in, so persisting it could hand a
 * session invitation to the next account on a shared phone.
 */

export interface PendingTogetherJoin {
  connection: "local" | "online";
  invitation: string;
  transport?: "lan" | "nearby";
}
export interface PendingTogetherJoinState {
  pending: PendingTogetherJoin | null;
  setPending: (value: PendingTogetherJoin) => void;
  clear: () => void;
  /** Alias for clear — called from `useAuth.signOut()`. */
  reset: () => void;
}

export const usePendingTogetherJoin = create<PendingTogetherJoinState>(
  (set) => ({
    pending: null,
    setPending: (value) => set({ pending: value }),
    clear: () => set({ pending: null }),
    reset: () => set({ pending: null }),
  }),
);

/** The route AuthGate replaces to once a session exists. */
export function pendingTogetherJoinRoute(value: PendingTogetherJoin): string {
  return `/(app)/together/join?connection=${value.connection}&invitation=${encodeURIComponent(value.invitation)}${value.transport ? `&transport=${value.transport}` : ""}`;
}
