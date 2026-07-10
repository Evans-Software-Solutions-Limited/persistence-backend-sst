/**
 * useActiveWorkoutRehydration — launch wiring for the `useActiveWorkout` slice.
 *
 * Mounted once under the app root (`app/_layout.tsx`), sibling to the
 * `useUserMode` rehydration. Runs once per signed-in user and keeps the
 * presentation slice in sync with SQLite, which is the EXISTENCE AUTHORITY for
 * an in-progress session (Hybrid guardrail #3).
 *
 * Reconciliation is bidirectional:
 *   - Slice restored from AsyncStorage but SQLite has no live session for this
 *     user (completed/cancelled on a prior launch, or a different account on
 *     the same device) → clear the orphan pointer so no ghost bar shows.
 *   - SQLite has a live session the slice doesn't know about (begun by a pre-05
 *     build, or whose `start()` didn't run this launch) → adopt it minimised.
 *   - A stored session older than STALE_THRESHOLD_HOURS → prompt resume/discard
 *     (STORY-007 AC 7.3). Discard cancels any unsynced set mutations
 *     (`cancelSessionCommand`) and clears the UI state.
 *
 * The slice itself stays adapter-free (unit-testable against AsyncStorage
 * alone); this hook owns the adapter/auth bridge + the prompt.
 *
 * Spec: specs/05-active-session/requirements.md STORY-007 (AC 7.2, 7.3, 7.5)
 *       specs/05-active-session/design.md § useActiveWorkout Zustand slice
 *         (Revised 2026-06-07 — Hybrid architecture)
 */

import { useEffect, useRef } from "react";
import { Alert } from "react-native";
import { cancelSessionCommand } from "@/application/commands/session";
import {
  pointerFromSession,
  STALE_THRESHOLD_HOURS,
  useActiveWorkout,
} from "@/state/active-workout";
import { useAdapters } from "./useAdapters";
import { useAuth } from "./useAuth";

/** "We found a workout from {date}" — friendly, locale-aware. Exported for test. */
export function formatStartedAt(startedAt: string): string {
  const ms = Date.parse(startedAt);
  if (!Number.isFinite(ms)) return "earlier";
  return new Date(ms).toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export type UseActiveWorkoutRehydrationOptions = {
  /** Test seam — swap the imperative prompt for an injected confirm fn. */
  confirm?: (args: {
    name: string;
    startedAt: string;
    onResume: () => void;
    onDiscard: () => void;
  }) => void;
};

function defaultConfirm(args: {
  name: string;
  startedAt: string;
  onResume: () => void;
  onDiscard: () => void;
}): void {
  Alert.alert(
    "Resume workout?",
    `We found "${args.name}" from ${formatStartedAt(args.startedAt)}. Resume where you left off, or discard it?`,
    [
      { text: "Discard", style: "destructive", onPress: args.onDiscard },
      { text: "Resume", style: "default", onPress: args.onResume },
    ],
  );
}

export function useActiveWorkoutRehydration(
  options: UseActiveWorkoutRehydrationOptions = {},
): void {
  const { storage } = useAdapters();
  const { session: authSession } = useAuth();
  const userId = authSession?.userId ?? null;
  const confirm = options.confirm ?? defaultConfirm;
  const ranForUserRef = useRef<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    // Run once per signed-in user. Re-running on a different userId is
    // intentional (account switch on the same device).
    if (ranForUserRef.current === userId) return;
    ranForUserRef.current = userId;

    let cancelled = false;
    void (async () => {
      const slice = useActiveWorkout.getState();
      await slice.rehydrate();
      if (cancelled) return;

      const live = storage.getActiveSession(userId);
      const { active } = useActiveWorkout.getState();

      // SQLite has no live session for this user.
      if (!live) {
        if (active) void useActiveWorkout.getState().end();
        return;
      }

      // SQLite session exists but the slice missed it (or restored a stale
      // mismatch from another account) → adopt it minimised.
      if (!active || active.sessionId !== live.id) {
        useActiveWorkout.getState().adopt(pointerFromSession(live));
      }

      // Stale (>24h): prompt resume/discard, keyed off the SQLite startedAt.
      const ageHours =
        (Date.now() - Date.parse(live.startedAt)) / (1000 * 60 * 60);
      if (ageHours > STALE_THRESHOLD_HOURS) {
        confirm({
          name: live.name,
          startedAt: live.startedAt,
          onResume: () => {
            // Already restored minimised — nothing further to do.
          },
          onDiscard: () => {
            // Coach Start-live: a discarded on-behalf session records
            // (cancelled) for the client (scoped + audited). The pointer was
            // just restored from AsyncStorage, so withClient survives here.
            const onBehalfClientId =
              useActiveWorkout.getState().active?.withClient?.id ?? null;
            cancelSessionCommand({ storage, userId }, { onBehalfClientId });
            void useActiveWorkout.getState().end();
          },
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, storage, confirm]);
}
