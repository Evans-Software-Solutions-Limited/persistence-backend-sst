import type { WorkoutFormState } from "@/ui/hooks/useWorkoutForm";

import { WorkoutFormBody } from "@/ui/presenters/WorkoutFormBody";

/**
 * <WorkoutCreatorPresenter> — v3 restyle onto the foundation kit + prototype
 * (~/Downloads/handoff/design-source/screens/workout-creator.jsx),
 * VISUAL LAYER ONLY (CLUSTER6_BRIEF #4a): every prop/callback/testID below
 * is unchanged. Editor === creator (design.md § 9), so the actual form body
 * is the shared `WorkoutFormBody` — this presenter only supplies the
 * creator-specific copy (header title, back testID, save label, owner-toggle
 * subtitle).
 */

interface WorkoutCreatorPresenterProps {
  readonly formState: WorkoutFormState;
  readonly isSubmitting: boolean;
  readonly hasAttemptedSubmit: boolean;
  readonly submitError: string | null;
  readonly pickerVisible: boolean;
  /**
   * Coach authoring context (route `?ctx=coach`). Drives the owner-visibility
   * toggle: shown only for coaches; athletes never see it (workout stays
   * personal / `showInOwnerLibrary` true).
   */
  readonly isCoachContext: boolean;
  readonly onSetName: (value: string) => void;
  readonly onSetDescription: (value: string) => void;
  readonly onSetVisibility: (value: WorkoutFormState["visibility"]) => void;
  readonly onSetShowInOwnerLibrary: (value: boolean) => void;
  readonly onAddExerciseTap: () => void;
  readonly onClosePicker: () => void;

  readonly onAddExercises: (exercises: any[]) => void;

  readonly onAddSuperset: (exercises: any[]) => void;
  readonly onRemoveExercise: (exerciseId: string) => void;
  readonly onExerciseConfigChange: (
    exerciseId: string,
    field: string,
    value: number,
  ) => void;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
}

export function WorkoutCreatorPresenter(props: WorkoutCreatorPresenterProps) {
  return (
    <WorkoutFormBody
      {...props}
      headerTitle="Create Workout"
      backTestID="creator-back-button"
      saveLabel="Save workout"
      ownerToggleSub="Keep this workout in your own library. Off by default — it stays assignable to clients either way."
    />
  );
}
