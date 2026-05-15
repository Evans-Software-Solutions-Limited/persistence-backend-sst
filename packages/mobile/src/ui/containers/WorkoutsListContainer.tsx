import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Alert } from "react-native";
import { deleteWorkoutCommand } from "@/application/commands/delete-workout.command";
import type { Workout } from "@/domain/models/workout";
import { tokenizeSearch } from "@/domain/services/exercise.service";
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

  // Re-read the cache whenever the tab regains focus. Mutations from
  // the modal stack (`/workouts/create`, `/workouts/[id]/edit`) write
  // through to SQLite via `createWorkoutCommand` /
  // `updateWorkoutCommand`, but `useWorkouts` only recomputes its
  // snapshot when its internal `cacheVersion` ticks. Without this
  // hook, navigating back from the creator/editor modal lands on a
  // stale list and the new/updated workout is invisible until pull-
  // to-refresh.
  const rereadCache = workouts.rereadCache;
  useFocusEffect(
    useCallback(() => {
      rereadCache();
    }, [rereadCache]),
  );

  const [searchQuery, setSearchQuery] = useState("");
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
    const filteredMine = filterBySearch(myAndAssigned, searchQuery);
    const filteredDefault = filterBySearch(sections.default, searchQuery);

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

  // M3: Quick Start (Story-009) is intentionally NOT surfaced on the
  // workouts page — legacy never had this CTA and we're keeping
  // parity. The /(app)/session route still resolves an empty
  // `?workoutId=` to a Quick Start session, so a future deep link or
  // tab-header CTA can opt in without code changes here.

  const onUpgrade = useCallback(() => {
    router.push("/coming-soon?feature=subscription" as never);
  }, []);

  // Card tap pushes the workout-detail SCREEN at /(app)/workouts/[id]
  // — replaces the prior in-list `WorkoutPopover` overlay so the
  // detail surface is a proper deep-linkable route, has stack-back
  // navigation, and matches the create/edit modals' presentation.
  const onWorkoutPress = useCallback((workout: { id: string }) => {
    router.push(`/(app)/workouts/${workout.id}` as never);
  }, []);

  const onEditWorkout = useCallback((workout: { id: string }) => {
    router.push(`/(app)/workouts/${workout.id}/edit` as never);
  }, []);

  const onStartWorkout = useCallback((workoutId: string) => {
    // M3 wired: starts a session from this template via the
    // /(app)/session modal. Container resolves ?workoutId= →
    // startSessionCommand({ workout }) (Story-001).
    router.push(`/(app)/session?workoutId=${workoutId}` as never);
  }, []);

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
              // optimistic cache removal happens inside the command,
              // and a DELETE intent goes onto the sync queue. We
              // intentionally `rereadCache()` instead of `refresh()`
              // here: refresh would race the still-pending DELETE
              // against the server (the server returns the not-yet-
              // deleted row, the cache gets overwritten, and the
              // workout reappears until the next hard reload).
              // `rereadCache` just propagates the local removal to
              // the snapshot; the queue worker eventually flushes
              // the DELETE on the next refresh / foreground / sync
              // tick.
              deleteWorkoutCommand({ storage, userId }, workout.id);
              setDeletingWorkoutIds((prev) => {
                const next = new Set(prev);
                next.delete(workout.id);
                return next;
              });
              rereadCache();
            },
          },
        ],
      );
    },
    [storage, userId, rereadCache],
  );

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
    />
  );
}

/**
 * Token-AND match against name + description. Reuses `tokenizeSearch`
 * so the workouts filter agrees with the exercise filter (and the
 * backend FTS tokeniser) on what a "token" is. Legacy mobile also
 * matched against a `tags` array — the v2 Workout wire shape has no
 * tags field today, so name + description is the full surface.
 */
function filterBySearch(workouts: Workout[], query: string): Workout[] {
  const tokens = tokenizeSearch(query);
  if (tokens.length === 0) return workouts;
  return workouts.filter((w) => {
    const haystack = `${w.name} ${w.description ?? ""}`.toLowerCase();
    return tokens.every((t) => haystack.includes(t));
  });
}
