import { router } from "expo-router";
import { useCallback, useState } from "react";
import { Alert } from "react-native";
import { createWorkoutCommand } from "@/application/commands/create-workout.command";
import type { CreateWorkoutInput } from "@/domain/models/workout";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import {
  EMPTY_FORM_STATE,
  useWorkoutForm,
  type WorkoutFormState,
} from "@/ui/hooks/useWorkoutForm";
import { WorkoutCreatorPresenter } from "@/ui/presenters/WorkoutCreatorPresenter";

/**
 * Creator container — owns form state via `useWorkoutForm`, opens the
 * picker, and submits via `createWorkoutCommand`. The submit boundary
 * maps the legacy snake_case form state onto the V2 camelCase
 * `CreateWorkoutInput`. On success the optimistic cache write inside
 * the command surfaces the new workout to the list immediately, then
 * the sync queue eventually swaps the temp id for the server one.
 *
 * Spec: specs/04-workout-management/requirements.md STORY-002 ACs
 *       2.1, 2.2, 2.7, 2.9, 2.10, 2.11, 2.12; STORY-003 ACs 3.1, 3.3
 */
export function WorkoutCreatorContainer() {
  const { storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;

  const form = useWorkoutForm(
    EMPTY_FORM_STATE,
    () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pickerVisible, setPickerVisible] = useState(false);

  const onAddExercise = useCallback(() => setPickerVisible(true), []);
  const onClosePicker = useCallback(() => setPickerVisible(false), []);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onAddExercises = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (exercises: any[]) => {
      form.addExercises(exercises);
      setPickerVisible(false);
    },
    [form],
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onAddSuperset = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (exercises: any[]) => {
      form.addSuperset(exercises);
      setPickerVisible(false);
    },
    [form],
  );

  const onSubmit = useCallback(() => {
    setHasAttemptedSubmit(true);
    setSubmitError(null);

    // Inline-presenter feedback covers the empty-name + empty-exercises
    // cases (driven by `hasAttemptedSubmit`); short-circuit here without
    // setting a duplicate `submitError`.
    if (form.state.name.trim().length === 0) return;
    if (form.state.exercises.length === 0) return;
    if (!userId) {
      setSubmitError("Sign in to save workouts");
      return;
    }

    setIsSubmitting(true);
    try {
      const input = toCreateWorkoutInput(form.state);
      const result = createWorkoutCommand(
        {
          storage,
          userId,
          generateId: () =>
            `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        },
        input,
      );
      if (!result.ok) {
        const firstFieldMessage =
          Object.values(result.error.fields)[0] ?? "Failed to save workout";
        setSubmitError(firstFieldMessage);
        return;
      }
      router.back();
    } finally {
      setIsSubmitting(false);
    }
  }, [storage, userId, form.state]);

  const onCancel = useCallback(() => {
    if (!form.isDirty) {
      router.back();
      return;
    }
    Alert.alert(
      "Discard Changes",
      "Are you sure you want to discard your changes?",
      [
        { text: "Keep Editing", style: "cancel" },
        {
          text: "Discard",
          style: "destructive",
          onPress: () => router.back(),
        },
      ],
    );
  }, [form.isDirty]);

  return (
    <WorkoutCreatorPresenter
      formState={form.state}
      isSubmitting={isSubmitting}
      hasAttemptedSubmit={hasAttemptedSubmit}
      submitError={submitError}
      pickerVisible={pickerVisible}
      onSetName={form.setName}
      onSetDescription={form.setDescription}
      onAddExerciseTap={onAddExercise}
      onClosePicker={onClosePicker}
      onAddExercises={onAddExercises}
      onAddSuperset={onAddSuperset}
      onRemoveExercise={form.removeExercise}
      onExerciseConfigChange={form.setExerciseField}
      onSubmit={onSubmit}
      onCancel={onCancel}
    />
  );
}

function toCreateWorkoutInput(state: WorkoutFormState): CreateWorkoutInput {
  return {
    name: state.name.trim(),
    description:
      state.description.trim().length === 0 ? null : state.description.trim(),
    visibility: state.visibility,
    estimatedDurationMinutes: state.estimatedDurationMinutes,
    exercises: state.exercises.map((ex) => ({
      exerciseId: ex.exercise_id,
      sortOrder: ex.sort_order,
      supersetGroup: ex.superset_group ?? null,
      targetSets: ex.target_sets,
      targetRepsMin: ex.target_reps_min,
      targetRepsMax: ex.target_reps_max,
      restSeconds: ex.rest_seconds,
    })),
  };
}
