import { router, useLocalSearchParams } from "expo-router";
import { useCallback } from "react";
import { Alert } from "react-native";

import { updateExerciseCommand } from "@/application/commands/update-exercise.command";
import type { CreateExerciseInput } from "@/domain/models/exercise";
import {
  toCreateExerciseInput,
  toFormInput,
  type NewExerciseInput,
} from "@/ui/components/exercises/ExerciseFormFields";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import { useExercise } from "@/ui/hooks/useExercise";
import { useExerciseLibrary } from "@/ui/hooks/useExerciseLibrary";
import { ExerciseEditorPresenter } from "@/ui/presenters/ExerciseEditorPresenter";

/**
 * <ExerciseEditorContainer> — wires `/(app)/exercises/[id]/edit` to the
 * offline-first `updateExerciseCommand`. Reached only via the owner-only Edit
 * affordance on the detail screen.
 *
 * Preserve-granular-unless-changed: the coarse picker is lossier than the
 * stored granular muscle/equipment arrays, so on save we keep the exercise's
 * original arrays for any field the user didn't actually change, and only
 * re-expand a field through `toCreateExerciseInput` when its picker moved.
 * This stops an edit (e.g. renaming) from silently broadening a "Quads-only"
 * exercise into all of Legs.
 *
 * Spec: specs/04-workout-management/requirements.md STORY-008
 */

/** Order-insensitive equality for the secondary-muscle label set. */
function sameLabelSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((x) => set.has(x));
}

export function ExerciseEditorContainer() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const exerciseId = id ?? null;
  const { exercise, isLoading, error, refresh } = useExercise(exerciseId);
  const { session } = useAuth();
  const { storage } = useAdapters();
  const markChanged = useExerciseLibrary((s) => s.markChanged);

  const isOwner =
    exercise !== null &&
    exercise.createdBy !== null &&
    exercise.createdBy === session?.userId;

  const onClose = useCallback(() => router.back(), []);
  const onRetry = useCallback(() => {
    void refresh();
  }, [refresh]);

  const onSave = useCallback(
    async (value: NewExerciseInput) => {
      if (!exercise) throw new Error("Exercise not loaded");

      // Re-expand coarse → granular for changed fields; preserve the stored
      // granular arrays for untouched ones (see container doc).
      const initial = toFormInput(exercise);
      const expanded = toCreateExerciseInput(value);

      const primaryChanged =
        value.primaryMuscleLabel !== initial.primaryMuscleLabel;
      const secondaryChanged = !sameLabelSet(
        value.secondaryMuscleLabels,
        initial.secondaryMuscleLabels,
      );
      const equipmentChanged = value.equipmentLabel !== initial.equipmentLabel;

      const input: CreateExerciseInput = {
        ...expanded,
        primaryMuscleGroups: primaryChanged
          ? expanded.primaryMuscleGroups
          : exercise.primaryMuscleGroups,
        secondaryMuscleGroups: secondaryChanged
          ? expanded.secondaryMuscleGroups
          : exercise.secondaryMuscleGroups,
        equipment: equipmentChanged ? expanded.equipment : exercise.equipment,
      };

      const result = updateExerciseCommand({ storage }, exercise, input);
      if (!result.ok) {
        const firstFieldMessage =
          Object.values(result.error.fields)[0] ?? "Failed to save changes";
        Alert.alert("Invalid input", firstFieldMessage);
        throw new Error(firstFieldMessage);
      }
      markChanged();
    },
    [exercise, storage, markChanged],
  );

  return (
    <ExerciseEditorPresenter
      exercise={exercise}
      isLoading={isLoading}
      error={error}
      isOwner={isOwner}
      onClose={onClose}
      onSave={onSave}
      onRetry={onRetry}
    />
  );
}
