import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import type {
  EquipmentType,
  ExerciseDifficulty,
  MuscleGroup,
} from "@/domain/models/exercise";
import { getExercisesQuery } from "@/application/queries/exercises.query";
import { ExerciseFiltersPresenter } from "@/ui/presenters/ExerciseFiltersPresenter";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useExerciseFilters } from "@/ui/hooks/useExerciseFilters";

/**
 * Modal container for the advanced filter sheet.
 *
 * Semantics:
 *   - Reads the currently-applied advanced filters from the shared context
 *     and copies them into local "pending" state on mount.
 *   - Every toggle updates pending state only — nothing is committed until
 *     the user taps Apply.
 *   - The live count on the Apply button runs `getExercisesQuery` against
 *     the pending state + the same search + quick-filter createdBy axis the
 *     list is using, so the number matches what the user will see on return.
 *   - Clear resets pending state only (does NOT touch the shared context
 *     until Apply is pressed — same as any form). A second Clear on the
 *     already-empty pending state is a no-op.
 *   - Close dismisses without committing.
 */
export function ExerciseFiltersContainer() {
  const router = useRouter();
  const { storage } = useAdapters();
  const {
    muscleGroups: appliedMuscleGroups,
    equipment: appliedEquipment,
    difficultiesAdvanced: appliedDifficulties,
    applyAdvanced,
    previewFiltersWithAdvanced,
  } = useExerciseFilters();

  // Pending state = the edits the user has made inside the modal that
  // haven't been committed yet. Initialised from the currently-applied
  // advanced filters so re-opening the modal shows the user's last state.
  const [pendingMuscleGroups, setPendingMuscleGroups] =
    useState<MuscleGroup[]>(appliedMuscleGroups);
  const [pendingEquipment, setPendingEquipment] =
    useState<EquipmentType[]>(appliedEquipment);
  const [pendingDifficulties, setPendingDifficulties] =
    useState<ExerciseDifficulty[]>(appliedDifficulties);

  const onToggleMuscleGroup = useCallback((g: MuscleGroup) => {
    setPendingMuscleGroups((prev) =>
      prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g],
    );
  }, []);

  const onToggleEquipment = useCallback((e: EquipmentType) => {
    setPendingEquipment((prev) =>
      prev.includes(e) ? prev.filter((x) => x !== e) : [...prev, e],
    );
  }, []);

  const onToggleDifficulty = useCallback((d: ExerciseDifficulty) => {
    setPendingDifficulties((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d],
    );
  }, []);

  const onClear = useCallback(() => {
    setPendingMuscleGroups([]);
    setPendingEquipment([]);
    setPendingDifficulties([]);
  }, []);

  const onApply = useCallback(() => {
    applyAdvanced({
      muscleGroups: pendingMuscleGroups,
      equipment: pendingEquipment,
      difficulties: pendingDifficulties,
    });
    router.back();
  }, [
    applyAdvanced,
    pendingMuscleGroups,
    pendingEquipment,
    pendingDifficulties,
    router,
  ]);

  const onClose = useCallback(() => {
    router.back();
  }, [router]);

  // Live match count for the Apply button. Delegates the merge to the hook's
  // `previewFiltersWithAdvanced`, which preserves every axis the modal doesn't
  // own (search, quick-filter createdBy, quick-filter difficulties, category)
  // and folds in the pending advanced values exactly how `applyAdvanced` will
  // on commit. Previously this container spread `currentFilters`, stripped
  // `difficulties`, and re-set it from `pendingDifficulties` alone — which
  // discarded quick-filter difficulty pills. The helper keeps the merge
  // semantics in one place so this class of drift can't come back.
  const matchCount = useMemo(() => {
    const pending = previewFiltersWithAdvanced({
      muscleGroups: pendingMuscleGroups,
      equipment: pendingEquipment,
      difficulties: pendingDifficulties,
    });
    const result = getExercisesQuery(storage, pending);
    return result.exercises.length;
  }, [
    storage,
    previewFiltersWithAdvanced,
    pendingMuscleGroups,
    pendingEquipment,
    pendingDifficulties,
  ]);

  return (
    <ExerciseFiltersPresenter
      difficulties={pendingDifficulties}
      equipment={pendingEquipment}
      muscleGroups={pendingMuscleGroups}
      matchCount={matchCount}
      onToggleDifficulty={onToggleDifficulty}
      onToggleEquipment={onToggleEquipment}
      onToggleMuscleGroup={onToggleMuscleGroup}
      onClear={onClear}
      onApply={onApply}
      onClose={onClose}
    />
  );
}
