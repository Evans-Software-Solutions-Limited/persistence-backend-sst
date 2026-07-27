import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo } from "react";
import {
  deriveDominantEquipment,
  deriveWorkoutMuscles,
} from "@/domain/services/workoutMeta";
import { useLoadoutFlow } from "@/state/loadout-flow";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import { useLoadoutGate } from "@/ui/hooks/useLoadoutGate";
import { useWorkoutVariations } from "@/ui/hooks/useWorkoutVariations";
import { useProfilePage } from "@/ui/hooks/useProfilePage";
import { useWorkout } from "@/ui/hooks/useWorkout";
import { useWorkoutHistory } from "@/ui/hooks/useWorkoutHistory";
import { WorkoutDetailPresenter } from "@/ui/presenters/WorkoutDetailPresenter";

/**
 * Workout-detail screen container. Routed at `/(app)/workouts/[id]` so the
 * detail surface is deep-linkable, presented as a stack-modal.
 *
 * v3 additions (Workout Authoring v2):
 *   - `useWorkoutHistory(id)` feeds the hero's completed-session stats block
 *     (independent online-direct fetch; renders only when there's history).
 *   - Muscle pills + the dominant-equipment eyebrow are derived from the
 *     cached exercise library (the same join the Train > Workouts list uses).
 *     No workout DTO change — equipment omitted when nothing resolves.
 *
 * Loadout (spec-21 T-2.2 / T-2.8) adds two owner-only surfaces: the "Adapt to
 * your gym" entry card and the "Saved setups" variation list. Both hang off
 * `useLoadoutFlow` — the flow itself is a root-mounted overlay
 * (`<LoadoutFlowContainer>`), so opening it is a store call, not a navigation.
 *
 * Spec: specs/milestones/WORKOUT-AUTHORING-V2/design.md § 10
 *       (legacy STORY-007 ACs 7.1, 7.2, 7.4 preserved)
 *       specs/21-adaptive-workout-ai/design.md § 10 · tasks.md T-2.2, T-2.8
 */
export function WorkoutDetailContainer() {
  const params = useLocalSearchParams<{ id?: string }>();
  const workoutId = params.id ?? null;
  const { storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;
  const weightUnit = useProfilePage().payload?.profile.weightUnit ?? "kg";

  const detail = useWorkout(workoutId);
  const history = useWorkoutHistory(workoutId);
  const loadoutGate = useLoadoutGate();
  const openLoadout = useLoadoutFlow((state) => state.open);
  const openLoadoutUpsell = useLoadoutFlow((state) => state.openUpsell);

  const workout = detail.workout;
  const isOwner =
    workout != null && userId != null && workout.createdBy === userId;

  // Only fetched for the owner: the variation list is scoped to the CALLER's own
  // variations server-side, so on someone else's workout it is always empty and
  // the request is pure waste.
  const variations = useWorkoutVariations(isOwner ? workoutId : null);

  // Derive muscle pills + the dominant equipment label from the cached
  // exercise library (workout refs carry neither). Recomputes only when the
  // workout identity changes — the cache read is cheap but keyed to the
  // workout so we don't re-scan on unrelated re-renders.
  const { muscles, equipmentLabel } = useMemo(() => {
    if (!workout) return { muscles: [] as string[], equipmentLabel: null };
    const muscleById = new Map<string, readonly string[]>();
    const equipmentById = new Map<string, readonly string[]>();
    for (const ex of storage.getCachedExercises()) {
      muscleById.set(ex.id, ex.primaryMuscleGroupLabels ?? []);
      // `equipment` holds DB UUIDs at runtime; the readable names live in
      // `equipmentLabels` (parallel to muscles). Use labels only — when the
      // library isn't fully cached the eyebrow gracefully drops the token.
      equipmentById.set(ex.id, ex.equipmentLabels ?? []);
    }
    return {
      muscles: deriveWorkoutMuscles(workout, (id) => muscleById.get(id)),
      equipmentLabel: deriveDominantEquipment(workout, (id) =>
        equipmentById.get(id),
      ),
    };
  }, [workout, storage]);

  const onClose = useCallback(() => {
    router.back();
  }, []);

  const onEdit = useCallback(() => {
    if (!workoutId) return;
    router.push(`/(app)/workouts/${workoutId}/edit` as never);
  }, [workoutId]);

  // Start CTA opens the active-session modal seeded from this template.
  const onStartWorkout = useCallback((id: string) => {
    router.push(`/(app)/session?workoutId=${id}` as never);
  }, []);

  // Stack-push the exercise detail on top so the workout stays underneath.
  const onExercisePress = useCallback((exerciseId: string) => {
    router.push(`/(app)/exercises/${exerciseId}` as never);
  }, []);

  // Locked still opens something — the upsell sheet. design § 5.2 makes the
  // paywall a conversion surface with no taster behind it, so a dead tap would
  // throw away the only pitch the feature gets.
  const onOpenLoadout = useCallback(() => {
    if (!workout) return;
    // ⚠ Do NOTHING until the subscription has resolved. `computeLoadoutVerdict`
    // denies a null subscription (deliberately — the alternative is flashing the
    // entry point as unlocked and then 402-ing), so during the cold-start
    // `/subscriptions/me` round trip a paying Premium+ user is indistinguishable
    // from a free one. Opening the upsell there sells the feature to the person
    // who already bought it.
    if (!loadoutGate.isResolved) return;
    if (!loadoutGate.allowed) {
      openLoadoutUpsell();
      return;
    }
    openLoadout(workout.id, workout.name);
  }, [
    workout,
    loadoutGate.isResolved,
    loadoutGate.allowed,
    openLoadout,
    openLoadoutUpsell,
  ]);

  // A variation IS a workout, so it opens on this same screen.
  const onOpenVariation = useCallback((variationId: string) => {
    router.push(`/(app)/workouts/${variationId}` as never);
  }, []);

  return (
    <WorkoutDetailPresenter
      workout={workout}
      history={history.history}
      isHistoryLoading={history.isLoading}
      muscles={muscles}
      equipmentLabel={equipmentLabel}
      isOwner={isOwner}
      isLoading={detail.isLoading}
      error={detail.error}
      weightUnit={weightUnit}
      onClose={onClose}
      onEdit={onEdit}
      onStartWorkout={onStartWorkout}
      onExercisePress={onExercisePress}
      showLoadout={isOwner}
      // Only claim "locked" once we actually know. Until then the card renders
      // its neutral pending copy rather than a padlock.
      loadoutLocked={loadoutGate.isResolved && !loadoutGate.allowed}
      loadoutPending={!loadoutGate.isResolved}
      loadoutVariations={variations.variations}
      onOpenLoadout={onOpenLoadout}
      onOpenVariation={onOpenVariation}
    />
  );
}
