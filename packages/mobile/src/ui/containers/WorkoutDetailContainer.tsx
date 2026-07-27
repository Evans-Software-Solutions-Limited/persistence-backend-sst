import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  deriveDominantEquipment,
  deriveWorkoutMuscles,
} from "@/domain/services/workoutMeta";
import { useLoadoutFlow } from "@/state/loadout-flow";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import { useLoadoutGate } from "@/ui/hooks/useLoadoutGate";
import { useSavedGyms } from "@/ui/hooks/useSavedGyms";
import { useWorkoutVariations } from "@/ui/hooks/useWorkoutVariations";
import { LoadoutUpsellSheet } from "@/ui/presenters/loadout/LoadoutUpsellSheet";
import { useProfilePage } from "@/ui/hooks/useProfilePage";
import { useWorkout } from "@/ui/hooks/useWorkout";
import { useWorkoutHistory } from "@/ui/hooks/useWorkoutHistory";
import { WorkoutDetailPresenter } from "@/ui/presenters/WorkoutDetailPresenter";
import { hasGymEquipmentChanged } from "@/domain/services/loadout.service";

/**
 * Workout-detail screen container. Routed at `/(app)/workouts/[id]` so the
 * detail surface is deep-linkable and participates in ordinary stack history.
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
 * `useLoadoutFlow`; the state is seeded before navigating to the dedicated
 * `/(app)/loadout` route.
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
  const selectLoadoutGym = useLoadoutFlow((state) => state.selectGym);
  const openLoadoutUpsell = useLoadoutFlow((state) => state.openUpsell);
  const loadoutUpsellOpen = useLoadoutFlow((state) => state.upsellOpen);
  const closeLoadoutUpsell = useLoadoutFlow((state) => state.closeUpsell);
  const loadoutRev = useLoadoutFlow((state) => state.rev);

  const workout = detail.workout;
  const isOwner =
    workout != null && userId != null && workout.createdBy === userId;
  const isVariation = workout?.parentWorkoutId != null;

  // Only fetched for the owner: the variation list is scoped to the CALLER's own
  // variations server-side, so on someone else's workout it is always empty and
  // the request is pure waste.
  const variations = useWorkoutVariations(
    isOwner && !isVariation ? workoutId : null,
  );
  const savedGyms = useSavedGyms(
    isOwner && isVariation && workout?.sourceGymId != null,
  );
  const sourceGym =
    workout?.sourceGymId == null
      ? null
      : (savedGyms.gyms.find((gym) => gym.id === workout.sourceGymId) ?? null);
  const sourceGymUpdated =
    workout != null &&
    hasGymEquipmentChanged({
      sourceGymId: workout.sourceGymId ?? null,
      sourceEquipmentTypeIds: workout.sourceEquipmentTypeIds ?? null,
      currentSourceGymEquipmentTypeIds: sourceGym?.equipmentTypeIds ?? null,
    });
  const loadoutContextPending =
    isVariation === true && workout?.sourceGymId != null && savedGyms.isLoading;

  // Replacing a variation happens while this detail screen sits underneath the
  // Loadout route. Refresh it as soon as the save lands so dismissing the flow
  // reveals the new plan, not the cached pre-adaptation exercises.
  const previousLoadoutRevRef = useRef(loadoutRev);
  useEffect(() => {
    if (previousLoadoutRevRef.current === loadoutRev) return;
    previousLoadoutRevRef.current = loadoutRev;
    if (isVariation) void detail.refresh();
  }, [detail, isVariation, loadoutRev]);

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
    //
    // A mutation sweep reports removing this as surviving, and that is expected:
    // the card is `disabled` while pending, so Testing Library's press never
    // reaches here. The two layers block different channels — the prop blocks the
    // touch, this blocks any other caller — and neither is redundant.
    if (!loadoutGate.isResolved || loadoutContextPending) return;
    if (!loadoutGate.allowed) {
      openLoadoutUpsell();
      return;
    }
    // Seed the store, then navigate. Both are synchronous in one tick and the
    // route only reads the store when it MOUNTS, so the order is not actually
    // load-bearing today — a mutation swapping them survives, correctly. Written
    // this way because it states the dependency: `/(app)/loadout` redirects out
    // on a null `workoutId`, and that redirect is the thing keeping a direct deep
    // link from rendering an empty shell.
    const rootWorkoutId = workout.parentWorkoutId ?? workout.id;
    openLoadout(rootWorkoutId, workout.name, isVariation ? workout.id : null);
    // A linked setup re-adapts against that gym immediately. If the gym was
    // deleted, fall back to collect so the user can choose a new context.
    if (isVariation && sourceGym !== null) {
      selectLoadoutGym(sourceGym);
    }
    router.push("/(app)/loadout" as never);
  }, [
    workout,
    isVariation,
    sourceGym,
    loadoutContextPending,
    loadoutGate.isResolved,
    loadoutGate.allowed,
    openLoadout,
    selectLoadoutGym,
    openLoadoutUpsell,
  ]);

  // A variation IS a workout, so it opens on this same screen.
  const onOpenVariation = useCallback((variationId: string) => {
    router.push(`/(app)/workouts/${variationId}` as never);
  }, []);

  return (
    <>
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
        // `pending` takes precedence over `locked` INSIDE the card, so this passes
        // the raw verdict rather than pre-masking it with `isResolved`. An earlier
        // version did both; the extra conjunct could not change any rendered
        // output, which a mutation sweep showed by surviving its removal.
        loadoutLocked={!loadoutGate.allowed}
        loadoutPending={!loadoutGate.isResolved || loadoutContextPending}
        loadoutMode={isVariation ? "readapt" : "adapt"}
        loadoutLinkedGymAvailable={!isVariation || sourceGym !== null}
        loadoutGymUpdated={sourceGymUpdated}
        loadoutVariations={variations.variations}
        onOpenLoadout={onOpenLoadout}
        onOpenVariation={isVariation ? undefined : onOpenVariation}
      />
      {/* The upsell belongs to, and is layered within, its owning screen. */}
      <LoadoutUpsellSheet
        visible={loadoutUpsellOpen}
        onClose={closeLoadoutUpsell}
        priceMonthly={loadoutGate.upgradePriceMonthly}
        onUpgrade={() => {
          closeLoadoutUpsell();
          loadoutGate.onUpgrade();
        }}
      />
    </>
  );
}
