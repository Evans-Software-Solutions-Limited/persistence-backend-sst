import { Text, View } from "@tamagui/core";

import { PLogoDrawLoader } from "@/ui/components/PLogoDrawLoader";
import type { ApiError } from "@/shared/errors";
import type { WorkoutFormState } from "@/ui/hooks/useWorkoutForm";
import { Btn } from "@/ui/components/foundation";
import { toneHex } from "@/ui/components/foundation/tones";
import { IconAlert } from "@/ui/components/icons";
import { WorkoutFormBody } from "@/ui/presenters/WorkoutFormBody";
import { SafeAreaView } from "react-native-safe-area-context";

/**
 * <WorkoutEditorPresenter> — v3 restyle onto the foundation kit + prototype
 * (~/Downloads/handoff/design-source/screens/workout-creator.jsx),
 * VISUAL LAYER ONLY (CLUSTER6_BRIEF #4a): every prop/callback/testID below
 * is unchanged. Editor === creator (design.md § 9) — the ready-state form is
 * the shared `WorkoutFormBody`; this presenter additionally owns the
 * `isLoading` / `loadError` early-return screens (restyled lightly, testIDs
 * kept: `editor-loading`, `editor-error`, `editor-error-back-button`).
 */

interface WorkoutEditorPresenterProps {
  readonly formState: WorkoutFormState;
  readonly isSubmitting: boolean;
  readonly hasAttemptedSubmit: boolean;
  readonly submitError: string | null;
  readonly pickerVisible: boolean;
  readonly isLoading: boolean;
  readonly loadError: ApiError | null;
  /** Coach editing context (`?ctx=coach`) → show the owner-visibility toggle. */
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
  readonly onGoBackFromError: () => void;
}

export function WorkoutEditorPresenter({
  isLoading,
  loadError,
  onGoBackFromError,
  ...rest
}: WorkoutEditorPresenterProps) {
  if (isLoading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: "#0A0B12" }}>
        <View
          flex={1}
          alignItems="center"
          justifyContent="center"
          testID="editor-loading"
        >
          <PLogoDrawLoader />
          <Text fontFamily="$body" fontSize={13} color="$text2" marginTop={12}>
            Loading workout…
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (loadError) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: "#0A0B12" }}>
        <View
          flex={1}
          alignItems="center"
          justifyContent="center"
          paddingHorizontal={24}
          gap={8}
          testID="editor-error"
        >
          <IconAlert size={48} color={toneHex("error").base} />
          <Text
            fontFamily="$display"
            fontWeight="700"
            fontSize={18}
            color="$text"
          >
            Failed to load workout
          </Text>
          <Text
            fontFamily="$body"
            fontSize={13}
            color="$text3"
            textAlign="center"
            marginBottom={8}
          >
            Please try again later
          </Text>
          <Btn
            variant="filled"
            tone="primary"
            onPress={onGoBackFromError}
            testID="editor-error-back-button"
          >
            Go Back
          </Btn>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <WorkoutFormBody
      {...rest}
      headerTitle="Edit Workout"
      backTestID="editor-back-button"
      saveLabel="Update workout"
      ownerToggleSub="Keep this workout in your own library. It stays assignable to clients either way."
    />
  );
}
