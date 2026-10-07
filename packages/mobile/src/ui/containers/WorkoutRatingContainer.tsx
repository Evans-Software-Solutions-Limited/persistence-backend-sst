import { completeTogetherSession } from "@/application/commands/session/complete-together-session.command";
/**
 * WorkoutRatingContainer — owns the rating-screen submit. Reads the
 * in-progress session via `useActiveSession`; on Submit fires
 * `completeSessionCommand({ rating, notes })` which flips status to
 * `completed`, builds the bulk-record payload, and queues the flush.
 * Then routes to the Summary screen for stats display.
 *
 * Spec: specs/05-active-session/requirements.md STORY-006
 */

import { Alert } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { getApiBaseUrl } from "@/adapters/api";
import { completeSessionCommand } from "@/application/commands/session";
import { processSyncQueue } from "@/application/commands/sync.command";
import { useActiveWorkout } from "@/state/active-workout";
import { useActiveSession } from "@/ui/hooks/useActiveSession";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import { WorkoutRatingPresenter } from "@/ui/presenters/WorkoutRatingPresenter";

export function WorkoutRatingContainer() {
  const { storage, auth, togetherLobby, togetherCloud } = useAdapters();
  const params = useLocalSearchParams<{
    mode?: string;
    groupFinish?: string;
    localSessionId?: string;
  }>();
  const { session: authSession } = useAuth();
  const { session: activeSession, userId } = useActiveSession();
  const latest = userId ? storage.getLatestSession(userId) : null;
  const ratingOwner = useRef<{ userId: string; id: string } | null>(null);
  if (userId && ratingOwner.current?.userId !== userId)
    ratingOwner.current = null;
  if (userId && activeSession && !ratingOwner.current)
    ratingOwner.current = { userId, id: activeSession.id };
  const expectedId = params.localSessionId ?? ratingOwner.current?.id;
  const session =
    (activeSession?.id === expectedId ? activeSession : null) ??
    (latest?.together && latest.id === expectedId ? latest : null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitting = useRef(false);
  const owner = useRef(userId);
  owner.current = userId;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Race-guard: bounce back ONLY after auth has resolved AND no
  // in-progress session is present. Routing back while auth is still
  // pending would unmount the screen before the user could interact.
  const authResolved = authSession !== undefined && authSession !== null;
  useEffect(() => {
    if (authResolved && !session && !submitting.current) {
      router.back();
    }
  }, [authResolved, session]);

  const onSubmit = useCallback(
    (rating: number, notes: string) => {
      if (!userId || submitting.current) return;
      submitting.current = true;
      setIsSubmitting(true);
      if (session?.together) {
        const isCurrent = () =>
          mounted.current &&
          owner.current === userId &&
          storage.getLatestSession(userId)?.id === session.id;
        void completeTogetherSession(
          {
            storage,
            workout: togetherLobby?.workout,
            shared: togetherLobby?.shared,
            localSharingAuthority: () => {
              const status = togetherLobby?.workout?.status(userId, session.id);
              const live = togetherLobby?.getSnapshot();
              const host = live?.members.find((m) => m.host);
              if (
                !status ||
                status.sessionId !== session.together?.sessionId ||
                !live ||
                !["hosting", "joined", "reconnecting"].includes(live.phase) ||
                !host
              )
                return null;
              if (!["active", "reconnecting"].includes(status.sharing)) {
                // A locally persisted closure stops new sharing before its send
                // is acknowledged. Keep replaying that exact event on retry.
                const closureMode =
                  params.mode === "finish_all"
                    ? "finish_all"
                    : host.userId === userId
                      ? "save_own"
                      : "leave";
                let retryOwnClosure = false;
                try {
                  retryOwnClosure =
                    (params.mode === "finish_all" ||
                      params.mode === "save_own") &&
                    !!togetherLobby?.shared
                      ?.getSnapshot()
                      .closures.some(
                        (closure) =>
                          closure.userId === userId &&
                          closure.mode === closureMode,
                      );
                } catch {
                  // The controller wrapper can outlive its disposed engine.
                  return null;
                }
                if (!retryOwnClosure) return null;
              }
              return { sessionId: status.sessionId, hostUserId: host.userId };
            },
            isLocalHost: () =>
              togetherLobby?.getSnapshot().role === "host" &&
              togetherLobby
                .getSnapshot()
                .members.some((m) => m.userId === userId && m.host),
            cloud: togetherCloud,
            userId,
            localSessionId: session.id,
            isCurrent,
          },
          { rating, notes, mode: params.mode },
        )
          .then(async (saved) => {
            if (!isCurrent()) return;
            // The durable result has closed the active session before navigation.
            await useActiveWorkout.getState().end();
            if (!isCurrent()) return;
            void togetherLobby?.cancel().catch(() => {});
            void processSyncQueue(storage, auth, getApiBaseUrl()).catch(
              () => {},
            );
            if (saved.status === "cancelled") {
              storage.clearActiveSession(userId);
              router.dismissAll();
            } else router.replace("/(app)/session/summary" as never);
          })
          .catch((error: unknown) => {
            if (!isCurrent()) return;
            Alert.alert(
              "Workout kept on this device",
              error instanceof Error && error.message === "review-required"
                ? "Some changes need your review before saving. Your workout has not been discarded."
                : "Could not confirm the save. Retry when connected, or go Back to end and discard this workout.",
              [
                { text: "OK" },
                ...(error instanceof Error &&
                error.message === "review-required"
                  ? [
                      {
                        text: "Review changes",
                        onPress: () => {
                          if (isCurrent())
                            router.push({
                              pathname:
                                session.together?.transport === "cloud"
                                  ? "/(app)/session/together-cloud-review"
                                  : "/(app)/session/together-review",
                              params: { localSessionId: session.id },
                            } as never);
                        },
                      },
                    ]
                  : []),
              ],
            );
          })
          .finally(() => {
            if (isCurrent()) {
              submitting.current = false;
              setIsSubmitting(false);
            }
          });
        return;
      }
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
      if (!result.ok && result.error.kind === "together_completion_pending") {
        submitting.current = false;
        setIsSubmitting(false);
        Alert.alert("Workout saved locally", result.error.message);
        return;
      }
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
        submitting.current = false;
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
    [userId, session, storage, auth, togetherLobby, togetherCloud, params.mode],
  );

  const onBack = useCallback(() => {
    router.back();
  }, []);

  if (!session) {
    // Auth still resolving OR no session — render nothing; the
    // useEffect above bounces if/when we confirm there's no session.
    return null;
  }

  const group =
    (params.mode === "finish_all" || params.groupFinish === "true") &&
    session.together
      ? session.together.transport === "cloud"
        ? togetherCloud
            ?.getSnapshot()
            .snapshot?.participants.map((member, index) => ({
              id: member.userId,
              name:
                member.userId === userId
                  ? "You"
                  : (member.displayName ?? `Athlete ${index + 1}`),
              own: member.userId === userId,
            }))
        : togetherLobby?.getSnapshot().members.map((member, index) => ({
            id: member.userId,
            name:
              member.userId === userId
                ? "You"
                : (togetherLobby.shared?.getSnapshot().profiles[
                    member.userId
                  ] ?? `Athlete ${index + 1}`),
            own: member.userId === userId,
          }))
      : undefined;
  return (
    <WorkoutRatingPresenter
      group={group}
      isLoading={isSubmitting}
      initialNotes={session.notes ?? ""}
      onSubmit={onSubmit}
      onBack={onBack}
    />
  );
}
