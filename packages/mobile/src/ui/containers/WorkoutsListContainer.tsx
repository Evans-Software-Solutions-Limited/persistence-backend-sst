import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo } from "react";
import { Alert } from "react-native";

import { deleteWorkoutCommand } from "@/application/commands/delete-workout.command";
import type { Workout } from "@/domain/models/workout";
import {
  classifyWorkoutSplit,
  type WorkoutSplit,
} from "@/domain/services/workoutSplit";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import { useWorkouts } from "@/ui/hooks/useWorkouts";
import { WorkoutsListPresenter } from "@/ui/presenters/WorkoutsListPresenter";

/**
 * Train > Workouts segment container. Owns data fetching (useWorkouts),
 * derives the two list sections — "saved" (mine + assigned) and
 * "templates" (public defaults) — and the navigation + mutation handlers.
 * Renders as a headerless body under <TrainHubContainer>.
 *
 * Spec: specs/04-workout-management/design.md § <WorkoutsListPresenter>
 *       (revised 2026-06-01 to the prototype-hubs.jsx composition)
 */
export function WorkoutsListContainer() {
  const { storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;

  const workouts = useWorkouts();

  // Re-read the cache on focus so workouts created/edited in the modal
  // stack (`/workouts/create`, `/workouts/[id]/edit`) appear without a
  // manual pull-to-refresh.
  const rereadCache = workouts.rereadCache;
  useFocusEffect(
    useCallback(() => {
      rereadCache();
    }, [rereadCache]),
  );

  // "MY WORKOUTS" = mine + assigned (the prototype shows a single saved
  // section); "TEMPLATES" = public defaults.
  const saved = useMemo(
    () => [...workouts.mine.workouts, ...workouts.assigned.workouts],
    [workouts.mine, workouts.assigned],
  );
  const templates = workouts.default.workouts;
  const quota = workouts.mine.quota;

  // Derive each workout's split (colored tile + badge) by joining its
  // exerciseIds against the cached exercise library for muscle groups. The
  // trimmed workout-exercise ref carries no muscles, so this is the only
  // client-side source; workouts whose exercises aren't cached yet simply
  // don't get a split (neutral tile, no badge). Recomputes when the workout
  // lists change (which a focus rereadCache ticks).
  const splits = useMemo(() => {
    // `primaryMuscleGroups` are DB UUIDs at runtime; the readable names are
    // in `primaryMuscleGroupLabels`. Pass both — the classifier resolves
    // labels + enum keys and ignores UUIDs.
    const tokensById = new Map<string, readonly string[]>();
    for (const ex of storage.getCachedExercises()) {
      tokensById.set(ex.id, [
        ...(ex.primaryMuscleGroupLabels ?? []),
        ...ex.primaryMuscleGroups,
      ]);
    }
    const getMuscleTokens = (id: string) => tokensById.get(id);
    const map = new Map<string, WorkoutSplit>();
    for (const w of [...saved, ...templates]) {
      const split = classifyWorkoutSplit(w, getMuscleTokens);
      if (split) map.set(w.id, split);
    }
    return map;
  }, [saved, templates, storage]);

  const used = quota?.used ?? 0;
  const limit = quota?.limit ?? null;
  const isAtLimit = limit !== null && used >= limit;

  const workoutsRefresh = workouts.refresh;
  const onRefresh = useCallback(
    () => void workoutsRefresh(),
    [workoutsRefresh],
  );

  const onCreate = useCallback(() => {
    router.push("/(app)/workouts/create" as never);
  }, []);

  const onUpgrade = useCallback(() => {
    router.push("/(app)/subscription-management" as never);
  }, []);

  const onOpen = useCallback((workoutId: string) => {
    router.push(`/(app)/workouts/${workoutId}` as never);
  }, []);

  const onStart = useCallback((workoutId: string) => {
    // Hands off to 05-active-session via the session route's ?workoutId=
    // param (the real session-start entry — no `useStartSession` hook
    // exists; the local active-session machine seeds from the template).
    router.push(`/(app)/session?workoutId=${workoutId}` as never);
  }, []);

  const confirmDelete = useCallback(
    (workout: Workout) => {
      Alert.alert(
        "Delete Workout",
        `Are you sure you want to delete "${workout.name}"? This action cannot be undone.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => {
              // `userId` is guaranteed non-null here: confirmDelete is only
              // reached via the owner long-press menu, which the presenter
              // wires only when currentUserId (=== userId) owns the workout.
              // Synchronous command: optimistic local removal + a DELETE
              // intent on the sync queue. rereadCache (not refresh) so the
              // still-pending DELETE doesn't race the server.
              deleteWorkoutCommand(
                { storage, userId: userId as string },
                workout.id,
              );
              rereadCache();
            },
          },
        ],
      );
    },
    [storage, userId, rereadCache],
  );

  // Owner long-press → Edit / Delete context menu (AC 1.6). The presenter
  // only wires this for rows the current user owns, so we can assume
  // ownership here. Delete opens a destructive confirm before committing.
  const onLongPress = useCallback(
    (workout: Workout) => {
      Alert.alert(workout.name, undefined, [
        {
          text: "Edit",
          onPress: () =>
            router.push(`/(app)/workouts/${workout.id}/edit` as never),
        },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => confirmDelete(workout),
        },
        { text: "Cancel", style: "cancel" },
      ]);
    },
    [confirmDelete],
  );

  const isInitialLoading =
    workouts.isRefreshing && saved.length === 0 && templates.length === 0;

  return (
    <WorkoutsListPresenter
      isInitialLoading={isInitialLoading}
      error={workouts.error}
      isRefreshing={workouts.isRefreshing}
      saved={saved}
      templates={templates}
      splits={splits}
      userWorkoutLimit={limit ?? undefined}
      isAtLimit={isAtLimit}
      currentUserId={userId ?? undefined}
      onCreate={onCreate}
      onUpgrade={onUpgrade}
      onOpen={onOpen}
      onStart={onStart}
      onLongPress={onLongPress}
      onRetry={onRefresh}
      onRefresh={onRefresh}
    />
  );
}
