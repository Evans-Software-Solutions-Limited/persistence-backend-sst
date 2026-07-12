import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Workout } from "@/domain/models/workout";
import { useUserMode } from "@/state/user-mode";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { CoachWorkoutLibraryPresenter } from "@/ui/presenters/coach/CoachWorkoutLibraryPresenter";

/**
 * Coach Workout library container. Coach-gated (a non-coach who deep-links
 * here is bounced to the tabs index, mirroring `ProgramEditorContainer`).
 *
 * Fetches the coach's authored workouts ONLINE-DIRECT and UNFILTERED
 * (`type="mine"`, no `ownerLibraryOnly`) into local state — deliberately NOT
 * the shared `useWorkouts` cache, which for a trainer holds the
 * owner-visible-filtered set. Re-reads on focus so a workout created/edited in
 * the modal stack reappears. Offline-cache upgrade is a tracked follow-up (S3).
 *
 * Spec: specs/milestones/WORKOUT-AUTHORING-V2/design.md § 11
 */
export function CoachWorkoutLibraryContainer() {
  const { api } = useAdapters();
  const mode = useUserMode((s) => s.mode);

  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Coach-only surface.
  useEffect(() => {
    if (mode !== "coach") {
      router.replace("/(app)/(tabs)");
    }
  }, [mode]);

  const inFlightRef = useRef(false);
  const load = useCallback(
    async (isRefresh: boolean) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      if (isRefresh) setIsRefreshing(true);
      try {
        const result = await api.getWorkouts({ type: "mine" });
        if (result.ok) {
          setWorkouts(result.value.workouts);
          setError(null);
        } else {
          setError(result.error.message || "Something went wrong");
        }
      } finally {
        inFlightRef.current = false;
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [api],
  );

  // Initial load + re-read whenever the screen regains focus (returning from
  // the create/edit modal).
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
    />
  );
}
