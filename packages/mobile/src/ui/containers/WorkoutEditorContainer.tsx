import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import { updateWorkoutCommand } from "@/application/commands/update-workout.command";
import type {
  UpdateWorkoutInput,
  Workout,
  WorkoutExercise,
} from "@/domain/models/workout";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import { useWorkout } from "@/ui/hooks/useWorkout";
import {
  EMPTY_FORM_STATE,
  useWorkoutForm,
  type WorkoutFormExercise,
  type WorkoutFormState,
} from "@/ui/hooks/useWorkoutForm";
import { WorkoutEditorPresenter } from "@/ui/presenters/WorkoutEditorPresenter";

/**
 * Editor container — async-loads the workout via `useWorkout(id)`,
 * resets the form once on first hydrate, then drives the same form
 * reducer the creator uses. Submit maps the snake_case form state
 * onto the V2 camelCase `UpdateWorkoutInput` (full-replacement on
 * `exercises` per backend PATCH semantics) and dispatches via
 * `updateWorkoutCommand`. The optimistic cache update inside the
 * command propagates the change to the list + popover before the
 * sync queue flushes the PATCH.
 *
 * Spec: specs/04-workout-management/requirements.md STORY-004 ACs
 *       4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7; STORY-006 AC 6.5
 */
export function WorkoutEditorContainer() {
  const { id: workoutIdParam } = useLocalSearchParams<{ id: string }>();
  const workoutId = workoutIdParam ?? null;

  const { storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;

  const detail = useWorkout(workoutId);
  const form = useWorkoutForm(
    EMPTY_FORM_STATE,
    () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pickerVisible, setPickerVisible] = useState(false);

  // Hydrate the form once when the cached workout first appears. Any
  // subsequent `detail.workout` change (e.g. a background refresh)
  // would clobber in-flight edits, so guard with a ref keyed on
  // `(userId, workoutId)`.
  const hydratedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!detail.workout || !userId || !workoutId) return;
    const key = `${userId}::${workoutId}`;
    if (hydratedForRef.current === key) return;
    hydratedForRef.current = key;
    form.reset(toFormState(detail.workout));
  }, [detail.workout, userId, workoutId, form]);

  const onAddExerciseTap = useCallback(() => setPickerVisible(true), []);
  const onClosePicker = useCallback(() => setPickerVisible(false), []);

  const onAddExercises = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (exercises: any[]) => {
      form.addExercises(exercises);
      setPickerVisible(false);
    },
    [form],
  );
  const onAddSuperset = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (exercises: any[]) => {
      form.addSuperset(exercises);
      setPickerVisible(false);
    },
    [form],
  );

  const onSubmit = useCallback(() => {
    if (!workoutId) return;
    setHasAttemptedSubmit(true);
    setSubmitError(null);

    if (form.state.name.trim().length === 0) return;
    if (form.state.exercises.length === 0) return;
    if (!userId) {
      setSubmitError("Sign in to save changes");
      return;
    }

    setIsSubmitting(true);
    try {
      const input = toUpdateWorkoutInput(form.state);
      const result = updateWorkoutCommand(
        {
          storage,
          userId,
          generateId: () =>
            `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        },
        workoutId,
        input,
      );
      if (!result.ok) {
        const firstFieldMessage =
          Object.values(result.error.fields)[0] ?? "Failed to save changes";
        setSubmitError(firstFieldMessage);
        return;
      }
      router.back();
    } finally {
      setIsSubmitting(false);
    }
  }, [storage, userId, workoutId, form.state]);

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

  const onGoBackFromError = useCallback(() => router.back(), []);

  return (
    <WorkoutEditorPresenter
      formState={form.state}
      isSubmitting={isSubmitting}
      hasAttemptedSubmit={hasAttemptedSubmit}
      submitError={submitError}
      pickerVisible={pickerVisible}
      isLoading={detail.isLoading && detail.workout === null}
      // Only surface the error screen when there's no cached workout
      // to edit — a refresh failure with a populated cache (e.g.
      // airplane mode) should fall through to the form so the user
      // can keep editing offline. STORY-008 AC 8.4.
      loadError={detail.workout === null ? detail.error : null}
      onSetName={form.setName}
      onSetDescription={form.setDescription}
      onSetVisibility={form.setVisibility}
      onAddExerciseTap={onAddExerciseTap}
      onClosePicker={onClosePicker}
      onAddExercises={onAddExercises}
      onAddSuperset={onAddSuperset}
      onRemoveExercise={form.removeExercise}
      onExerciseConfigChange={form.setExerciseField}
      onSubmit={onSubmit}
      onCancel={onCancel}
      onGoBackFromError={onGoBackFromError}
    />
  );
}

function toFormState(workout: Workout): WorkoutFormState {
  return {
    name: workout.name,
    description: workout.description ?? "",
    estimatedDurationMinutes: workout.estimatedDurationMinutes,
    visibility: workout.visibility,
    exercises: workout.exercises.map(toFormExercise),
  };
}

function toFormExercise(ex: WorkoutExercise): WorkoutFormExercise {
  return {
    id: ex.id,
    exercise_id: ex.exerciseId,
    exercise_name: ex.exercise?.name ?? "Exercise",
    sort_order: ex.sortOrder,
    target_sets: ex.targetSets ?? 3,
    target_reps_min: ex.targetRepsMin,
    target_reps_max: ex.targetRepsMax,
    rest_seconds: ex.restSeconds ?? 60,
    superset_group: ex.supersetGroup,
  };
}

function toUpdateWorkoutInput(state: WorkoutFormState): UpdateWorkoutInput {
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
