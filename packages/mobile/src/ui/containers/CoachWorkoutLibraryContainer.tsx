import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Workout } from "@/domain/models/workout";
import { useUserMode } from "@/state/user-mode";
import { useAdapters } from "@/ui/hooks/useAdapters";
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
  const { api, storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;
  const mode = useUserMode((s) => s.mode);

  // Cache-first: read the dedicated coach-library slot as soon as the session
  // (userId) resolves. `useAuth` seeds userId via an effect, so this lands on
  // the render after mount — matching the `useWorkout` cache pattern.
  const [cacheVersion, setCacheVersion] = useState(0);
  const cached = useMemo(() => {
    void cacheVersion;
    return userId ? storage.getCachedCoachWorkoutLibrary(userId) : null;
  }, [storage, userId, cacheVersion]);

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
        const result = await api.getWorkouts({ type: "mine" });
        if (result.ok) {
          storage.cacheCoachWorkoutLibrary(userId, result.value.workouts);
          setWorkouts(result.value.workouts);
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
    [api, storage, userId],
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
