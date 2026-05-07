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
import { completeSessionCommand } from "@/application/commands/session";
import { useActiveSession } from "@/ui/hooks/useActiveSession";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import { WorkoutRatingPresenter } from "@/ui/presenters/WorkoutRatingPresenter";

export function WorkoutRatingContainer() {
  const { storage } = useAdapters();
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
      const result = completeSessionCommand(
        { storage, userId },
        { rating, notes: notes.trim() || null },
      );
      if (!result.ok) {
        // No active session → already finalized. Bounce to summary
        // so the user can see their stats anyway.
        setIsSubmitting(false);
        router.replace("/(app)/session/summary" as never);
        return;
      }
      // Replace (not push) so the back stack doesn't accumulate
      // /rate → /summary indefinitely if the user re-finishes.
      router.replace("/(app)/session/summary" as never);
    },
    [userId, isSubmitting, storage],
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
