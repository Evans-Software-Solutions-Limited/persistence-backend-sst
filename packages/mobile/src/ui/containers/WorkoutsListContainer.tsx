import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import { Alert } from "react-native";
import { deleteWorkoutCommand } from "@/application/commands/delete-workout.command";
import type { Workout } from "@/domain/models/workout";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import { useWorkouts } from "@/ui/hooks/useWorkouts";
import { WorkoutsListPresenter } from "@/ui/presenters/WorkoutsListPresenter";

/**
 * Workouts tab container — owns data fetching (useWorkouts), local UI
 * state (search query, popover, deleting set), and handlers. Mirrors
 * `HomeContainer` / `ExerciseListContainer`'s 3-memo pipeline pattern:
 * cachedPayload → viewModel → handlers.
 *
 * Active-session, creator, and editor navigation route to `/coming-soon`
 * placeholders for now. Creator + editor land in the follow-up mobile
 * PR; active-session is M3.
 *
 * Spec: specs/04-workout-management/design.md § UI Components (mobile)
 *       specs/04-workout-management/requirements.md STORY-001 ACs 1.1, 1.5–1.9
 */
export function WorkoutsListContainer() {
  const { storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;

  const workouts = useWorkouts();
  const { workoutId: routeWorkoutId } = useLocalSearchParams<{
    workoutId?: string;
  }>();

  const [searchQuery, setSearchQuery] = useState("");
  const [popoverWorkoutId, setPopoverWorkoutId] = useState<string | null>(null);
  const [deletingWorkoutIds, setDeletingWorkoutIds] = useState<Set<string>>(
    new Set(),
  );

  // Memo #1: cached payload — slice the three sections off the hook
  // return so dependents below don't re-run when isRefreshing toggles.
  const sections = useMemo(
    () => ({
      mine: workouts.mine.workouts,
      assigned: workouts.assigned.workouts,
      default: workouts.default.workouts,
      quota: workouts.mine.quota,
    }),
    [workouts.mine, workouts.assigned, workouts.default],
  );

  // Memo #2: view model — filter by search, derive section subtitles,
  // map V2 Workouts into the legacy `any`-shape the verbatim-ported
  // WorkoutCard reads (snake_case + a few denormalised fields).
  const viewModel = useMemo(() => {
    const myAndAssigned = [...sections.mine, ...sections.assigned];
    const filteredMine = filterByName(myAndAssigned, searchQuery);
    const filteredDefault = filterByName(sections.default, searchQuery);

    const assignedIdSet = new Set(sections.assigned.map((w) => w.id));
    const toCardView = (w: Workout) => ({
      id: w.id,
      name: w.name,
      description: w.description,
      estimated_duration_minutes: w.estimatedDurationMinutes,
      created_by: w.createdBy,
      is_assigned: assignedIdSet.has(w.id),
      // TODO(M8): legacy distinguishes physio vs PT — V2's
      // workout_assignments table has trainer.role; surface it when
      // M8 wires the trainer-side write surface.
      assigned_by_type: assignedIdSet.has(w.id) ? "personal_trainer" : null,
      // TODO(M4): aggregate targeted_muscles from
      // workout.exercises[].exercise.primary_muscles once the
      // backend includes those on the GET /workouts/:id response.
      targeted_muscles: [],
      exercises: w.exercises,
    });

    const used = sections.quota?.used ?? 0;
    const limit = sections.quota?.limit ?? null;
    const isAtLimit = limit !== null && used >= limit;

    // Note: `myAndAssigned.map(toCardView)` is intentionally NOT in the
    // returned shape. The presenter only consumes `filteredMyWorkouts`
    // (which already covers the unfiltered case when searchQuery is
    // empty — `filterByName` is a passthrough then). Computing both was
    // duplicate work flagged by bugbot.
    return {
      myAndAssignedCount: myAndAssigned.length,
      mineCount: sections.mine.length,
      assignedCount: sections.assigned.length,
      defaultCount: sections.default.length,
      filteredMyWorkouts: filteredMine.map(toCardView),
      filteredExampleWorkouts: filteredDefault.map(toCardView),
      userWorkoutLimit: limit ?? undefined,
      isAtLimit,
    };
  }, [sections, searchQuery]);

  // Memo #3: handlers (stable references for the presenter).
  const workoutsRefresh = workouts.refresh;
  const onRefresh = useCallback(
    () => void workoutsRefresh(),
    [workoutsRefresh],
  );

  const onSearchChange = useCallback((q: string) => setSearchQuery(q), []);

  // Note: the QuickActions Create button is `disabled={isAtLimit}` so
  // this handler doesn't fire when the user is over quota — the
  // WorkoutLimitIndicator's "Upgrade Now" CTA is the explicit at-limit
  // path. Matches legacy behaviour.
  const onCreateWorkout = useCallback(() => {
    router.push("/(app)/workouts/create" as never);
  }, []);

  const onBrowseExercises = useCallback(() => {
    router.push("/(app)/(tabs)/exercises" as never);
  }, []);

  const onUpgrade = useCallback(() => {
    router.push("/coming-soon?feature=subscription" as never);
  }, []);

  const onWorkoutPress = useCallback(
    (workout: { id: string }) => setPopoverWorkoutId(workout.id),
    [],
  );

  const onEditWorkout = useCallback((workout: { id: string }) => {
    router.push(`/(app)/workouts/${workout.id}/edit` as never);
  }, []);

  const onStartWorkout = useCallback((workoutId: string) => {
    // TODO(M3): wire to /workouts/[id]/active.
    void workoutId;
    router.push("/coming-soon?feature=active-session" as never);
  }, []);

  const onClosePopover = useCallback(() => setPopoverWorkoutId(null), []);

  const onDeleteWorkout = useCallback(
    (workout: { id: string; name: string }) => {
      if (!userId) return;
      Alert.alert(
        "Delete Workout",
        `Are you sure you want to delete "${workout.name}"? This action cannot be undone.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => {
              setDeletingWorkoutIds((prev) => new Set(prev).add(workout.id));
              // The command is synchronous and only touches storage —
              // it can't fail in practice. Optimistic cache removal
              // happens inside the command; the post-call refresh
              // syncs the React snapshot with storage.
              deleteWorkoutCommand({ storage, userId }, workout.id);
              setDeletingWorkoutIds((prev) => {
                const next = new Set(prev);
                next.delete(workout.id);
                return next;
              });
              void workoutsRefresh();
            },
          },
        ],
      );
    },
    [storage, userId, workoutsRefresh],
  );

  // Popover detail — read from cached_workout_detail (populated by the
  // list refresh's splatter step) or fall back to the matching slice
  // entry. No separate getById call needed for cache-warm popover.
  const popoverWorkout = useMemo<Workout | null>(() => {
    if (!popoverWorkoutId) return null;
    const all = [...sections.mine, ...sections.assigned, ...sections.default];
    return all.find((w) => w.id === popoverWorkoutId) ?? null;
  }, [popoverWorkoutId, sections]);

  // Surface route-param deeplink (e.g. notification tap with workoutId).
  React.useEffect(() => {
    if (!routeWorkoutId || popoverWorkoutId) return;
    const all = [...sections.mine, ...sections.assigned, ...sections.default];
    if (all.some((w) => w.id === routeWorkoutId)) {
      setPopoverWorkoutId(routeWorkoutId);
    }
  }, [routeWorkoutId, popoverWorkoutId, sections]);

  return (
    <WorkoutsListPresenter
      isInitialLoading={
        workouts.isRefreshing &&
        sections.mine.length === 0 &&
        sections.assigned.length === 0 &&
        sections.default.length === 0
      }
      error={workouts.error}
      isRefreshing={workouts.isRefreshing}
      searchQuery={searchQuery}
      myAndAssignedCount={viewModel.myAndAssignedCount}
      mineCount={viewModel.mineCount}
      assignedCount={viewModel.assignedCount}
      defaultCount={viewModel.defaultCount}
      filteredMyWorkouts={viewModel.filteredMyWorkouts}
      filteredExampleWorkouts={viewModel.filteredExampleWorkouts}
      userWorkoutLimit={viewModel.userWorkoutLimit}
      isAtLimit={viewModel.isAtLimit}
      currentUserId={userId ?? undefined}
      deletingWorkoutIds={deletingWorkoutIds}
      onCreateWorkout={onCreateWorkout}
      onBrowseExercises={onBrowseExercises}
      onUpgrade={onUpgrade}
      onSearchChange={onSearchChange}
      onWorkoutPress={onWorkoutPress}
      onEditWorkout={onEditWorkout}
      onDeleteWorkout={onDeleteWorkout}
      onStartWorkout={onStartWorkout}
      onRetry={onRefresh}
      onRefresh={onRefresh}
      popoverVisible={popoverWorkoutId !== null}
      popoverWorkout={popoverWorkout}
      onClosePopover={onClosePopover}
    />
  );
}

function filterByName(workouts: Workout[], query: string): Workout[] {
  if (!query.trim()) return workouts;
  const q = query.toLowerCase();
  return workouts.filter((w) => w.name.toLowerCase().includes(q));
}
