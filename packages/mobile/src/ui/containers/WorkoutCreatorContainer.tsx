import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useState } from "react";
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
 * picker, and submits. Two submit paths:
 *
 *   - Default (athlete + coach-library create): optimistic offline
 *     `createWorkoutCommand` (cache write + sync-queue POST).
 *   - Create-and-assign (coach, `?assignClientId=`): DIRECT online
 *     `api.createWorkout` → `api.assignWorkout` so the ad-hoc assignment can
 *     reference the SERVER workout id (the optimistic command only yields a
 *     local id). On partial failure the created workout is kept and the
 *     assign error surfaced (retry via AssignWorkoutSheet).
 *
 * Coach context (`?ctx=coach`, or any assign flow) renders the Visibility
 * tri-state + the owner-visibility toggle (default OFF → `showInOwnerLibrary`
 * false). Athlete create renders Visibility only (a parity fix — create was
 * previously always private) and sends `showInOwnerLibrary` true.
 *
 * Spec: specs/milestones/WORKOUT-AUTHORING-V2/design.md § 8, § 11;
 *       specs/04-workout-management/requirements.md STORY-002/003
 */
export function WorkoutCreatorContainer() {
  const { api, storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;

  const params = useLocalSearchParams<{
    ctx?: string;
    assignClientId?: string;
    assignClientName?: string;
  }>();
  const assignClientId = params.assignClientId ?? null;
  const isCoachContext = params.ctx === "coach" || assignClientId !== null;

  const generateId = useCallback(
    () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    [],
  );

  // Coach authoring defaults the workout OUT of the coach's personal library.
  const initialFormState = useMemo<WorkoutFormState>(
    () => ({ ...EMPTY_FORM_STATE, showInOwnerLibrary: !isCoachContext }),
    [isCoachContext],
  );
  const form = useWorkoutForm(initialFormState, generateId);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pickerVisible, setPickerVisible] = useState(false);

  const onAddExercise = useCallback(() => setPickerVisible(true), []);
  const onClosePicker = useCallback(() => setPickerVisible(false), []);

  const onAddExercises = useCallback(
    (exercises: any[]) => {
      form.addExercises(exercises);
      setPickerVisible(false);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [form.addExercises],
  );
  const onAddSuperset = useCallback(
    (exercises: any[]) => {
      form.addSuperset(exercises);
      setPickerVisible(false);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [form.addSuperset],
  );

  const onSubmit = useCallback(() => {
    setHasAttemptedSubmit(true);
    setSubmitError(null);

    if (form.state.name.trim().length === 0) return;
    if (form.state.exercises.length === 0) return;
    if (!userId) {
      setSubmitError("Sign in to save workouts");
      return;
    }

    const input = toCreateWorkoutInput(form.state);

    // Coach create-and-assign — direct online so we get the server workout id.
    if (assignClientId) {
      setIsSubmitting(true);
      void (async () => {
        try {
          const created = await api.createWorkout(input);
          if (!created.ok) {
            setSubmitError(created.error.message ?? "Failed to create workout");
            return;
          }
          const assigned = await api.assignWorkout(assignClientId, {
            workoutId: created.value.id,
          });
          if (!assigned.ok) {
            // Workout was created — keep it; surface the assign failure so the
            // coach can retry from the assign sheet rather than losing work.
            Alert.alert(
              "Workout created, not assigned",
              "Your workout was saved but couldn't be assigned to this client. You can assign it from their profile.",
            );
            router.back();
            return;
          }
          router.back();
        } finally {
          setIsSubmitting(false);
        }
      })();
      return;
    }

    // Default optimistic offline create.
    setIsSubmitting(true);
    try {
      const result = createWorkoutCommand(
        { storage, userId, generateId },
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
  }, [api, storage, userId, generateId, assignClientId, form.state]);

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
      isCoachContext={isCoachContext}
      onSetName={form.setName}
      onSetDescription={form.setDescription}
      onSetVisibility={form.setVisibility}
      onSetShowInOwnerLibrary={form.setShowInOwnerLibrary}
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
    showInOwnerLibrary: state.showInOwnerLibrary,
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
