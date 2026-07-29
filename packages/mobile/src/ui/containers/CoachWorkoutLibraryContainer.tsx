import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getApiBaseUrl } from "@/adapters/api";
import { processSyncQueue } from "@/application/commands/sync.command";
import { mergePreservingUnsynced } from "@/application/queries/workouts.query";
import type { Workout } from "@/domain/models/workout";
import { useUserMode } from "@/state/user-mode";
import { WORKOUT_TABLES } from "@/adapters/storage";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useCacheRevision } from "@/ui/hooks/useCacheRevision";
import { useWorkoutLibrary } from "@/ui/hooks/useWorkoutLibrary";
import { useAuth } from "@/ui/hooks/useAuth";
import { CoachWorkoutLibraryPresenter } from "@/ui/presenters/coach/CoachWorkoutLibraryPresenter";

/**
 * Coach Workout library container. Coach-gated (a non-coach who deep-links
 * here is bounced to the tabs index, mirroring `ProgramEditorContainer`).
 *
 * Cache-first (S3): a synchronous read from the DEDICATED
 * `cached_coach_workout_library` slot renders immediately (so the library
 * works offline), then every focus refreshes ONLINE + UNFILTERED
 * (`type="mine"`, no `ownerLibraryOnly`) and writes through. The dedicated
 * slot deliberately avoids the shared `useWorkouts`/`cached_workouts` mine
 * cache, which for a trainer holds the owner-visible-filtered set.
 *
 * `embedded` (specs/24-coach-authoring § B.3): when rendered as the Workouts
 * body of `<CoachLibraryHubContainer>`, the presenter drops its own
 * SafeAreaView top edge + back-button header (the hub owns that chrome).
 * Standalone (the `app/(app)/workouts/library.tsx` route, still deep-link
 * reachable) keeps the header + back unchanged.
 *
 * Spec: specs/milestones/WORKOUT-AUTHORING-V2/design.md § 11
 */
export function CoachWorkoutLibraryContainer({
  embedded = false,
}: { embedded?: boolean } = {}) {
  const { api, auth, storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;
  const mode = useUserMode((s) => s.mode);

  // Cache-first: read the dedicated coach-library slot as soon as the session
  // (userId) resolves. `useAuth` seeds userId via an effect, so this lands on
  // the render after mount — matching the `useWorkout` cache pattern.
  const [cacheVersion, setCacheVersion] = useState(0);
  // React to local writes: `createWorkoutCommand` now prepends a coach-authored
  // workout to this slice offline, and the focus handler is network-first, so
  // without this the new row waited for a successful GET.
  const storageRevision = useCacheRevision(WORKOUT_TABLES);
  const libraryRevision = useWorkoutLibrary((s) => s.revision);
  const cached = useMemo(() => {
    void cacheVersion;
    void storageRevision;
    void libraryRevision;
    return userId ? storage.getCachedCoachWorkoutLibrary(userId) : null;
  }, [storage, userId, cacheVersion, storageRevision, libraryRevision]);

  const [workouts, setWorkouts] = useState<Workout[]>(cached ?? []);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Surface the cached list as soon as it resolves (userId populates / a
  // write-through bumps cacheVersion).
  useEffect(() => {
    if (cached) setWorkouts(cached);
  }, [cached]);

  // Coach-only surface.
  useEffect(() => {
    if (mode !== "coach") {
      router.replace("/(app)/(tabs)");
    }
  }, [mode]);

  const inFlightRef = useRef(false);
  const load = useCallback(
    async (isRefresh: boolean) => {
      if (!userId || inFlightRef.current) return;
      inFlightRef.current = true;
      if (isRefresh) setIsRefreshing(true);
      try {
        // Drain the sync queue BEFORE the GET — otherwise a just-created
        // workout's optimistic POST is still queued and this fetch returns
        // the pre-create list, so the new workout appears to vanish until
        // the next focus (mirrors useWorkouts' refresh()).
        try {
          await processSyncQueue(storage, auth, getApiBaseUrl());
        } catch (err) {
          console.error(
            "[CoachWorkoutLibraryContainer] queue flush failed:",
            err,
          );
        }
        const result = await api.getWorkouts({ type: "mine" });
        if (result.ok) {
          // ⚠ Preserve rows the server cannot know about yet — the same guard
          // `refreshWorkouts` applies to `cached_workouts`, and needed here for
          // the same reason: `cacheCoachWorkoutLibrary` REPLACES the whole slice.
          //
          // This slice is where a coach-authored workout (`showInOwnerLibrary:
          // false`) lands when created offline, and it is the ONLY place it
          // lands. The drain above cannot save us: the enqueue already kicked
          // `useSyncWorker`'s flush, so `markMutationInFlight` returns false and
          // this pass skips the create by design (the PR #62 race guard). The GET
          // then returns the pre-create list and the optimistic row is deleted —
          // reappearing on a later focus if the create eventually lands, but gone
          // from the UI *permanently* if it ends `permanently_failed`, blocked or
          // exhausted, while the payload sits unexplained in /sync-failed.
          const merged = mergePreservingUnsynced(
            storage,
            storage.getCachedCoachWorkoutLibrary(userId),
            result.value.workouts,
          );
          storage.cacheCoachWorkoutLibrary(userId, merged);
          setWorkouts(merged);
          setCacheVersion((v) => v + 1);
          setError(null);
        } else {
          // Non-fatal: keep whatever cached list is already on screen.
          setError(result.error.message || "Something went wrong");
        }
      } finally {
        inFlightRef.current = false;
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [api, auth, storage, userId],
  );

  // Cache-first refresh: re-read on every focus (also picks up a workout
  // created/edited in the modal stack).
  useFocusEffect(
    useCallback(() => {
      void load(false);
    }, [load]),
  );

  const onBack = useCallback(() => router.back(), []);
  const onCreate = useCallback(() => {
    router.push("/(app)/workouts/create?ctx=coach" as never);
  }, []);
  const onOpen = useCallback((workoutId: string) => {
    router.push(`/(app)/workouts/${workoutId}/edit?ctx=coach` as never);
  }, []);
  const onRefresh = useCallback(() => void load(true), [load]);

  return (
    <CoachWorkoutLibraryPresenter
      workouts={workouts}
      isLoading={isLoading}
      isRefreshing={isRefreshing}
      error={error}
      onBack={onBack}
      onCreate={onCreate}
      onOpen={onOpen}
      onRefresh={onRefresh}
      embedded={embedded}
    />
  );
}
