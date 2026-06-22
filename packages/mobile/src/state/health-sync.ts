import { create } from "zustand";

/**
 * useHealthSync — cross-screen "health permissions just changed" signal.
 *
 * The Health connect screen and the Home dashboard each own their own
 * `useHealthData()` instance (separate hook state). When the user grants
 * access on the connect screen, Home's instance has no way to know. This
 * slice bridges them: the connect screen calls `markConnected()` after a
 * successful grant, and Home reads `revision` to decide whether its next
 * focus should force a fresh (rate-limit-bypassing) HealthKit read instead
 * of the usual rate-limited one.
 *
 * Deliberately tiny — a monotonic counter, no AsyncStorage. A cold launch
 * starts at 0; the first grant in a session bumps it to 1.
 *
 * Spec: specs/07-health-integration/design.md § Data Flow (rate-limited
 *       reads, AC 7.6) — this keeps the 5-min window intact on ordinary tab
 *       returns while still surfacing a just-granted connection immediately.
 */

export interface HealthSyncState {
  /** Monotonic counter bumped on each successful permission grant. */
  revision: number;
  markConnected: () => void;
}

export const useHealthSync = create<HealthSyncState>((set) => ({
  revision: 0,
  markConnected: () => set((s) => ({ revision: s.revision + 1 })),
}));
