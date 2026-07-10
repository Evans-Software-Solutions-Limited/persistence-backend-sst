/**
 * WorkoutRatingContainer — owns the rating-screen submit. Reads the
 * in-progress session via `useActiveSession`; on Submit fires
 * `completeSessionCommand({ rating, notes })` which flips status to
 * `completed`, builds the bulk-record payload, and queues the flush.
 * Then routes to the Summary screen for stats display.
 *
 * Spec: specs/05-active-session/requirements.md STORY-006
 */

import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { getApiBaseUrl } from "@/adapters/api";
import { completeSessionCommand } from "@/application/commands/session";
import { processSyncQueue } from "@/application/commands/sync.command";
import { useActiveWorkout } from "@/state/active-workout";
import { useActiveSession } from "@/ui/hooks/useActiveSession";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import { WorkoutRatingPresenter } from "@/ui/presenters/WorkoutRatingPresenter";

export function WorkoutRatingContainer() {
  const { storage, auth } = useAdapters();
  const { session: authSession } = useAuth();
  const { session, userId } = useActiveSession();
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Race-guard: bounce back ONLY after auth has resolved AND no
  // in-progress session is present. Routing back while auth is still
  // pending would unmount the screen before the user could interact.
  const authResolved = authSession !== undefined && authSession !== null;
  useEffect(() => {
    if (authResolved && !session) {
      router.back();
    }
  }, [authResolved, session]);

  const onSubmit = useCallback(
    (rating: number, notes: string) => {
      if (!userId || isSubmitting) return;
      setIsSubmitting(true);
      // Capture the coach on-behalf context BEFORE end() clears the pointer.
      // Present only for a coach-run Start-live session (M18).
      const withClient = useActiveWorkout.getState().active?.withClient ?? null;
      const result = completeSessionCommand(
        { storage, userId },
        {
          rating,
          notes: notes.trim() || null,
          onBehalfClientId: withClient?.id ?? null,
        },
      );
      // STORY-009 AC 9.4 — the session is finalized (or already was), so
      // clear the useActiveWorkout UI-state slice. Idempotent + safe in both
      // branches (under Hybrid Option A the slice is usually already empty;
      // this also drops the M8/M18 withClient/retroactive trainer context).
      void useActiveWorkout.getState().end();

      // Coach Start-live returns to Client Detail (NOT the athlete PR-summary
      // screen — that cache is keyed by the coach's own userId and the
      // on-behalf flush is deliberately gated out of it). Clear the local
      // session so no ghost bar lingers, then dismiss the session modals back
      // to Client Detail, whose focus effect refreshes the now-completed
      // occurrence.
      const goCoachHome = () => {
        storage.clearActiveSession(userId);
        router.dismissAll();
      };

      if (!result.ok) {
        // No active session → already finalized. Route the user somewhere
        // sensible anyway (Client Detail for the coach, summary otherwise).
        setIsSubmitting(false);
        if (withClient) {
          goCoachHome();
        } else {
          router.replace("/(app)/session/summary" as never);
        }
        return;
      }
      // Kick off an inline sync drain BEFORE routing — the user just
      // tapped Submit, which is the canonical "save my workout now"
      // signal, but `useSyncWorker` only fires on mount + AppState →
      // active. Without this push, the bulk-record POST sits in the
      // queue forever (until the user backgrounds + foregrounds the
      // app or relaunches), and the Summary screen's `cacheRecordResponse`
      // poll falls through to the local-prediction em-dash + dropped
      // count.
      //
      // Fire-and-forget: the Summary container's existing 500ms poll
      // catches the cache write whenever it lands. Errors here are
      // already logged + the per-entry retry path inside
      // processSyncQueue handles transient failures. Awaiting the
      // drain would defeat V2's offline-first invariant (Submit must
      // not block on the network).
      void processSyncQueue(storage, auth, getApiBaseUrl()).catch((err) => {
        console.warn("[WorkoutRatingContainer] post-submit drain failed:", err);
      });

      if (withClient) {
        goCoachHome();
        return;
      }
      // Replace (not push) so the back stack doesn't accumulate
      // /rate → /summary indefinitely if the user re-finishes.
      router.replace("/(app)/session/summary" as never);
    },
    [userId, isSubmitting, storage, auth],
  );

  const onBack = useCallback(() => {
    router.back();
  }, []);

  if (!session) {
    // Auth still resolving OR no session — render nothing; the
    // useEffect above bounces if/when we confirm there's no session.
    return null;
  }

  return (
    <WorkoutRatingPresenter
      isLoading={isSubmitting}
      initialNotes={session.notes ?? ""}
      onSubmit={onSubmit}
      onBack={onBack}
    />
  );
}
