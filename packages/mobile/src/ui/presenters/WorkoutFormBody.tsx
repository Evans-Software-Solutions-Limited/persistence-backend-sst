import { Text, View } from "@tamagui/core";
import React from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AddExercisePopover } from "@/ui/components/workouts/AddExercisePopover";
import { ExerciseConfigCard } from "@/ui/components/workouts/ExerciseConfigCard";
import { buildSupersetLetterMap } from "@/ui/presenters/supersetLetters";
import type {
  WorkoutFormExercise,
  WorkoutFormState,
} from "@/ui/hooks/useWorkoutForm";
import { Btn, Field, HeaderBar, IconBtn } from "@/ui/components/foundation";
import { toneHex } from "@/ui/components/foundation/tones";
import { color } from "@/ui/theme/tokens";
import {
  IconDumbbell,
  IconLogout,
  IconPlus,
  IconUser,
  IconUsers,
  IconX,
} from "@/ui/components/icons";

/**
 * <WorkoutFormBody> — the shared creator/editor form body (v3 restyle onto
 * the foundation kit + ~/Downloads/handoff/design-source/screens/
 * workout-creator.jsx). Editor === creator (design.md § 9): both screens are
 * this same body, differing only in header title / back testID / save label
 * / owner-toggle copy / editing flag, which the two thin presenters
 * (`WorkoutCreatorPresenter`, `WorkoutEditorPresenter`) pass in.
 *
 * VISUAL LAYER ONLY — every prop, testID, and business-logic branch here
 * mirrors the pre-restyle presenters exactly (CLUSTER6_BRIEF #4a). The
 * editor's `isLoading` / `loadError` early-return screens live in
 * `WorkoutEditorPresenter` itself (this body only renders once the workout
 * is ready to edit).
 *
 * OUT OF SCOPE (flagged, not built — see CLUSTER6_BRIEF report):
 *  - Drag-to-reorder (no reorder logic in `useWorkoutForm`).
 *  - Delete-workout + confirm modal (no `onDelete` prop / endpoint).
 *  - The prototype's Save button dims/disables when the form is invalid —
 *    NOT ported: the existing tested flow relies on tapping Save while
 *    invalid to set `hasAttemptedSubmit` and surface the inline errors, so
 *    disabling on invalid would silently break that (Save only disables
 *    while `isSubmitting`, matching pre-restyle behaviour).
 */

const VISIBILITY_OPTIONS: readonly {
  value: WorkoutFormState["visibility"];
  label: string;
  hint: string;
}[] = [
  { value: "private", label: "Private", hint: "Only you" },
  { value: "friends", label: "Friends", hint: "Your circle" },
  { value: "public", label: "Public", hint: "Anyone" },
];

const VISIBILITY_ICON: Record<
  WorkoutFormState["visibility"],
  React.ComponentType<{ size?: number; color?: string }>
> = {
  private: IconLogout,
  friends: IconUsers,
  public: IconUser,
};

export type WorkoutFormBodyProps = {
  readonly formState: WorkoutFormState;
  readonly isSubmitting: boolean;
  readonly hasAttemptedSubmit: boolean;
  readonly submitError: string | null;
  readonly pickerVisible: boolean;
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

  /** "Create Workout" / "Edit Workout" — kept verbatim (container tests assert it). */
  readonly headerTitle: string;
  /** "creator-back-button" / "editor-back-button". */
  readonly backTestID: string;
  /** "Save workout" / "Update workout". */
  readonly saveLabel: string;
  /** Owner-visibility toggle subtitle copy (creator vs editor differ slightly). */
  readonly ownerToggleSub: string;
};

export function WorkoutFormBody({
  formState,
  isSubmitting,
  hasAttemptedSubmit,
  submitError,
  pickerVisible,
  isCoachContext,
  onSetName,
  onSetDescription,
  onSetVisibility,
  onSetShowInOwnerLibrary,
  onAddExerciseTap,
  onClosePicker,
  onAddExercises,
  onAddSuperset,
  onRemoveExercise,
  onExerciseConfigChange,
  onSubmit,
  onCancel,
  headerTitle,
  backTestID,
  saveLabel,
  ownerToggleSub,
}: WorkoutFormBodyProps) {
  const exercises = formState.exercises;
  const supersetLetters = buildSupersetLetterMap(
    exercises.map((ex) => ex.superset_group),
  );
  const nameError =
    hasAttemptedSubmit && formState.name.trim().length === 0
      ? "Workout name is required"
      : null;

  return (
    <>
      <SafeAreaView style={{ flex: 1, backgroundColor: "#0A0B12" }}>
        <View flex={1}>
          <HeaderBar
            title={headerTitle}
            leading={
              <IconBtn
                icon={<IconX size={17} />}
                tone="neutral"
                onPress={onCancel}
                accessibilityLabel="Cancel"
                testID={backTestID}
              />
            }
          />

          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
          >
            <ScrollView
              style={{ flex: 1, paddingHorizontal: 16 }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              contentContainerStyle={{ paddingBottom: 24 }}
              automaticallyAdjustKeyboardInsets
            >
              <View gap={18} paddingTop={6}>
                <Field label="Workout name" required>
                  <TextInput
                    value={formState.name}
                    onChangeText={onSetName}
                    placeholder="e.g. Upper Body"
                    placeholderTextColor="#5C5C68"
                    testID="workout-name-input"
                    style={{
                      backgroundColor: "#1A1D29",
                      borderRadius: 10,
                      borderWidth: 1,
                      borderColor: nameError
                        ? toneHex("error").base
                        : "rgba(255,255,255,0.06)",
                      paddingHorizontal: 14,
                      paddingVertical: 12,
                      color: "#F4F4F8",
                      fontFamily: "Geist",
                      fontSize: 15,
                      fontWeight: "600",
                    }}
                  />
                  {nameError ? (
                    <Text
                      fontFamily="$body"
                      fontSize={12}
                      color="$error"
                      marginTop={4}
                    >
                      {nameError}
                    </Text>
                  ) : null}
                </Field>

                <Field label="Description" optional>
                  <TextInput
                    value={formState.description}
                    onChangeText={onSetDescription}
                    placeholder="Optional notes — tempo, focus, coaching cues…"
                    placeholderTextColor="#5C5C68"
                    multiline
                    numberOfLines={3}
                    testID="workout-description-input"
                    style={{
                      backgroundColor: "#1A1D29",
                      borderRadius: 10,
                      borderWidth: 1,
                      borderColor: "rgba(255,255,255,0.06)",
                      paddingHorizontal: 14,
                      paddingVertical: 12,
                      minHeight: 72,
                      textAlignVertical: "top",
                      color: "#F4F4F8",
                      fontFamily: "Geist",
                      fontSize: 13.5,
                      fontWeight: "400",
                      lineHeight: 20,
                    }}
                  />
                </Field>

                <Field label="Visibility">
                  <View flexDirection="row" gap={6}>
                    {VISIBILITY_OPTIONS.map((opt) => {
                      const selected = formState.visibility === opt.value;
                      const Icon = VISIBILITY_ICON[opt.value];
                      return (
                        <Pressable
                          key={opt.value}
                          onPress={() => onSetVisibility(opt.value)}
                          testID={`visibility-${opt.value}`}
                          style={({ pressed }) => ({
                            flex: 1,
                            opacity: pressed ? 0.85 : 1,
                          })}
                        >
                          <View
                            alignItems="center"
                            gap={4}
                            paddingVertical={11}
                            paddingHorizontal={6}
                            borderRadius={12}
                            borderWidth={1}
                            borderColor={selected ? "$primary" : "$border"}
                            backgroundColor={
                              selected ? "$primaryDim" : "$surface2"
                            }
                          >
                            <Icon
                              size={14}
                              color={
                                selected ? toneHex("primary").base : "#C2C2CE"
                              }
                            />
                            <Text
                              fontFamily="$display"
                              fontWeight="600"
                              fontSize={12.5}
                              color={selected ? "$primary" : "$text2"}
                            >
                              {opt.label}
                            </Text>
                            <Text
                              fontFamily="$body"
                              fontSize={9.5}
                              color={selected ? "$primary" : "$text4"}
                            >
                              {opt.hint}
                            </Text>
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                </Field>

                {isCoachContext ? (
                  <View
                    flexDirection="row"
                    alignItems="center"
                    gap={12}
                    padding={14}
                    borderRadius={12}
                    borderWidth={1}
                    borderColor="$border"
                    backgroundColor="$surface2"
                  >
                    <View flex={1}>
                      <Text
                        fontFamily="$display"
                        fontWeight="600"
                        fontSize={13.5}
                        color="$text"
                      >
                        Show in my workouts
                      </Text>
                      <Text
                        fontFamily="$body"
                        fontSize={11.5}
                        color="$text3"
                        marginTop={2}
                      >
                        {ownerToggleSub}
                      </Text>
                    </View>
                    <Switch
                      value={formState.showInOwnerLibrary}
                      onValueChange={onSetShowInOwnerLibrary}
                      trackColor={{
                        false: color.$surface3,
                        true: color.$primary,
                      }}
                      testID="show-in-owner-library-toggle"
                    />
                  </View>
                ) : null}

                <View>
                  <View
                    flexDirection="row"
                    alignItems="center"
                    justifyContent="space-between"
                    paddingHorizontal={2}
                    marginBottom={10}
                  >
                    <Text
                      fontFamily="$display"
                      fontSize={10.5}
                      fontWeight="600"
                      letterSpacing={1.7}
                      textTransform="uppercase"
                      color="$text3"
                    >
                      {`Exercises · ${exercises.length}`}
                    </Text>
                  </View>

                  {exercises.length === 0 ? (
                    <View alignItems="center" paddingVertical={32} gap={8}>
                      <IconDumbbell
                        size={40}
                        color={
                          hasAttemptedSubmit ? toneHex("error").base : "#5C5C68"
                        }
                      />
                      <Text
                        fontFamily="$display"
                        fontWeight="700"
                        fontSize={16}
                        color={hasAttemptedSubmit ? "$error" : "$text"}
                      >
                        {hasAttemptedSubmit
                          ? "Please add at least one exercise"
                          : "No exercises added"}
                      </Text>
                      <Text
                        fontFamily="$body"
                        fontSize={13}
                        color="$text3"
                        textAlign="center"
                      >
                        Tap &quot;Add Exercise&quot; to browse and select
                        exercises for your workout
                      </Text>
                    </View>
                  ) : (
                    <View gap={10}>
                      {exercises.map((exercise, index) => {
                        const hasSupersetGroup =
                          exercise.superset_group !== null;
                        const supersetExercises: WorkoutFormExercise[] =
                          hasSupersetGroup
                            ? exercises.filter(
                                (ex) =>
                                  ex.superset_group === exercise.superset_group,
                              )
                            : [];
                        const isSupersetStart =
                          hasSupersetGroup &&
                          supersetExercises[0]?.id === exercise.id;
                        const isSupersetEnd =
                          hasSupersetGroup &&
                          supersetExercises.at(-1)?.id === exercise.id;

                        return (
                          <View key={exercise.id}>
                            <ExerciseConfigCard
                              exercise={exercise}
                              index={index}
                              onRemove={() => onRemoveExercise(exercise.id)}
                              onConfigChange={(field, value) =>
                                onExerciseConfigChange(
                                  exercise.id,
                                  field,
                                  value,
                                )
                              }
                              isSupersetStart={isSupersetStart}
                              isSupersetEnd={isSupersetEnd}
                              supersetGroupNumber={
                                exercise.superset_group ?? undefined
                              }
                              supersetLetter={
                                exercise.superset_group !== null
                                  ? supersetLetters.get(exercise.superset_group)
                                  : undefined
                              }
                              supersetLeadExercise={supersetExercises[0]}
                            />
                          </View>
                        );
                      })}
                    </View>
                  )}

                  <Pressable
                    onPress={onAddExerciseTap}
                    testID="add-exercise-button"
                    style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
                  >
                    <View
                      flexDirection="row"
                      alignItems="center"
                      justifyContent="center"
                      gap={8}
                      marginTop={12}
                      padding={14}
                      borderRadius={12}
                      borderWidth={1.5}
                      borderStyle="dashed"
                      borderColor="$border3"
                      backgroundColor="$surface"
                    >
                      <IconPlus
                        size={16}
                        strokeWidth={2.5}
                        color={toneHex("primary").base}
                      />
                      <Text
                        fontFamily="$display"
                        fontWeight="600"
                        fontSize={13.5}
                        color="$primary"
                      >
                        Add exercise
                      </Text>
                    </View>
                  </Pressable>

                  {submitError ? (
                    <Text
                      fontFamily="$body"
                      fontSize={13}
                      color="$error"
                      marginTop={10}
                    >
                      {submitError}
                    </Text>
                  ) : null}
                </View>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>

          <View
            flexDirection="row"
            alignItems="center"
            gap={10}
            padding={16}
            borderTopWidth={1}
            borderColor="$border"
            backgroundColor="$surface"
          >
            <View flex={1}>
              <Btn
                variant="outline"
                tone="primary"
                size="lg"
                full
                onPress={onCancel}
              >
                Cancel
              </Btn>
            </View>
            <View flex={1.6}>
              <Btn
                variant="filled"
                tone="primary"
                size="lg"
                full
                onPress={onSubmit}
                disabled={isSubmitting}
                testID="save-workout-button"
              >
                {isSubmitting ? "Saving…" : saveLabel}
              </Btn>
            </View>
          </View>
        </View>
      </SafeAreaView>

      <AddExercisePopover
        visible={pickerVisible}
        onClose={onClosePicker}
        onAddExercises={onAddExercises}
        onAddSuperset={onAddSuperset}
        existingExerciseIds={exercises.map((ex) => ex.exercise_id)}
      />
    </>
  );
}
