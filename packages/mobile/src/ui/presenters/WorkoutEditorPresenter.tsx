import {
  BorderRadius,
  Colors,
  Spacing,
  Typography,
} from "@/ui/theme/workoutsLegacyTheme";
import { AddExercisePopover } from "@/ui/components/workouts/AddExercisePopover";
import { ExerciseConfigCard } from "@/ui/components/workouts/ExerciseConfigCard";
import { buildSupersetLetterMap } from "@/ui/presenters/supersetLetters";
import { PLogoDrawLoader } from "@/ui/components/PLogoDrawLoader";
import type { ApiError } from "@/shared/errors";
import type {
  WorkoutFormExercise,
  WorkoutFormState,
} from "@/ui/hooks/useWorkoutForm";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

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

const VISIBILITY_OPTIONS: readonly {
  value: WorkoutFormState["visibility"];
  label: string;
}[] = [
  { value: "private", label: "Private" },
  { value: "friends", label: "Friends" },
  { value: "public", label: "Public" },
];

export function WorkoutEditorPresenter({
  formState,
  isSubmitting,
  hasAttemptedSubmit,
  submitError,
  pickerVisible,
  isLoading,
  loadError,
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
  onGoBackFromError,
}: WorkoutEditorPresenterProps) {
  if (isLoading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingContainer} testID="editor-loading">
          <PLogoDrawLoader />
          <Text style={styles.loadingText}>Loading workout…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (loadError) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.errorContainer} testID="editor-error">
          <Ionicons
            name="alert-circle-outline"
            size={48}
            color={Colors.error.DEFAULT}
          />
          <Text style={styles.errorTitle}>Failed to load workout</Text>
          <Text style={styles.errorMessage}>Please try again later</Text>
          <TouchableOpacity
            style={styles.errorButton}
            onPress={onGoBackFromError}
            testID="editor-error-back-button"
          >
            <Text style={styles.errorButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

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
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity
              style={styles.backButton}
              onPress={onCancel}
              testID="editor-back-button"
            >
              <Ionicons
                name="arrow-back"
                size={24}
                color={Colors.text.primary}
              />
            </TouchableOpacity>
            <Text style={styles.screenTitle}>Edit Workout</Text>
            <View style={styles.placeholder} />
          </View>

          {/* See WorkoutCreatorPresenter for the rationale on the explicit
              KeyboardAvoidingView wrapper. Same pattern, same reason: long
              forms where the keyboard can cover the focused TextInput. */}
          <KeyboardAvoidingView
            style={styles.keyboardAvoider}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
          >
            <ScrollView
              style={styles.content}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              contentContainerStyle={styles.scrollContentContainer}
              automaticallyAdjustKeyboardInsets
            >
              <View style={styles.section}>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Workout Name *</Text>
                  <TextInput
                    style={[
                      styles.textInput,
                      nameError && styles.textInputError,
                    ]}
                    placeholder="Enter workout name"
                    placeholderTextColor={Colors.text.secondary}
                    value={formState.name}
                    onChangeText={onSetName}
                    testID="workout-name-input"
                  />
                  {nameError && (
                    <Text style={styles.errorText}>{nameError}</Text>
                  )}
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Description</Text>
                  <TextInput
                    style={[styles.textInput, styles.textArea]}
                    placeholder="Enter workout description (optional)"
                    placeholderTextColor={Colors.text.secondary}
                    value={formState.description}
                    onChangeText={onSetDescription}
                    multiline
                    numberOfLines={3}
                    testID="workout-description-input"
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Visibility</Text>
                  <View style={styles.visibilityRow}>
                    {VISIBILITY_OPTIONS.map((opt) => {
                      const selected = formState.visibility === opt.value;
                      return (
                        <TouchableOpacity
                          key={opt.value}
                          style={[
                            styles.visibilityOption,
                            selected && styles.visibilityOptionSelected,
                          ]}
                          onPress={() => onSetVisibility(opt.value)}
                          testID={`visibility-${opt.value}`}
                        >
                          <Text
                            style={[
                              styles.visibilityOptionText,
                              selected && styles.visibilityOptionTextSelected,
                            ]}
                          >
                            {opt.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                {isCoachContext && (
                  <View style={styles.ownerToggleRow}>
                    <View style={styles.ownerToggleCopy}>
                      <Text style={styles.ownerToggleTitle}>
                        Show in my workouts
                      </Text>
                      <Text style={styles.ownerToggleSub}>
                        Keep this workout in your own library. It stays
                        assignable to clients either way.
                      </Text>
                    </View>
                    <Switch
                      value={formState.showInOwnerLibrary}
                      onValueChange={onSetShowInOwnerLibrary}
                      trackColor={{
                        false: Colors.surface.tertiary,
                        true: Colors.primary.DEFAULT,
                      }}
                      testID="show-in-owner-library-toggle"
                    />
                  </View>
                )}
              </View>

              {/* Exercises */}
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>
                    Exercises ({exercises.length})
                  </Text>
                  <TouchableOpacity
                    style={styles.addExerciseButton}
                    onPress={onAddExerciseTap}
                    testID="add-exercise-button"
                  >
                    <Ionicons
                      name="add"
                      size={20}
                      color={Colors.primary.DEFAULT}
                    />
                    <Text style={styles.addExerciseButtonText}>
                      Add Exercise
                    </Text>
                  </TouchableOpacity>
                </View>

                {exercises.length === 0 ? (
                  <View style={styles.emptyExercises}>
                    <Ionicons
                      name="fitness-outline"
                      size={48}
                      color={
                        hasAttemptedSubmit
                          ? Colors.error.DEFAULT
                          : Colors.text.tertiary
                      }
                    />
                    <Text
                      style={[
                        styles.emptyExercisesTitle,
                        hasAttemptedSubmit && styles.emptyExercisesTitleError,
                      ]}
                    >
                      {hasAttemptedSubmit
                        ? "Please add at least one exercise"
                        : "No exercises added"}
                    </Text>
                    <Text style={styles.emptyExercisesMessage}>
                      Tap &quot;Add Exercise&quot; to browse and select
                      exercises for your workout
                    </Text>
                  </View>
                ) : (
                  <View style={styles.exercisesList}>
                    {exercises.map((exercise, index) => {
                      const hasSupersetGroup = exercise.superset_group !== null;
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
                              onExerciseConfigChange(exercise.id, field, value)
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
                {submitError && (
                  <Text style={styles.errorText}>{submitError}</Text>
                )}
              </View>

              {/* Save Button */}
              <View style={styles.section}>
                <TouchableOpacity
                  style={[
                    styles.saveButton,
                    isSubmitting && styles.saveButtonDisabled,
                  ]}
                  onPress={onSubmit}
                  disabled={isSubmitting}
                  testID="save-workout-button"
                >
                  <Text style={styles.saveButtonText}>
                    {isSubmitting ? "Saving…" : "Update Workout"}
                  </Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
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

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background.primary,
  },
  container: {
    flex: 1,
    backgroundColor: Colors.background.primary,
  },
  keyboardAvoider: {
    flex: 1,
  },
  scrollContentContainer: {
    flexGrow: 1,
    paddingBottom: Spacing.xl,
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingText: {
    ...Typography.body2,
    marginTop: Spacing.md,
    color: Colors.text.secondary,
  },
  errorContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.lg,
  },
  errorTitle: {
    ...Typography.h3,
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
  },
  errorMessage: {
    ...Typography.body2,
    textAlign: "center",
    marginBottom: Spacing.lg,
    color: Colors.text.secondary,
  },
  errorButton: {
    backgroundColor: Colors.primary.DEFAULT,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  errorButtonText: {
    ...Typography.body1,
    color: Colors.text.primary,
    fontWeight: "600",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surface.border,
  },
  backButton: {
    padding: Spacing.sm,
  },
  placeholder: {
    width: 40,
  },
  screenTitle: {
    ...Typography.body1,
    fontWeight: "600",
    flex: 1,
    textAlign: "center",
  },
  content: {
    flex: 1,
    paddingHorizontal: Spacing.md,
  },
  section: {
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  sectionTitle: {
    ...Typography.h3,
    marginBottom: Spacing.md,
  },
  inputGroup: {
    marginBottom: Spacing.md,
  },
  inputLabel: {
    ...Typography.body2,
    color: Colors.text.secondary,
    marginBottom: Spacing.sm,
  },
  textInput: {
    backgroundColor: Colors.surface.primary,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.surface.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    ...Typography.body1,
    color: Colors.text.primary,
  },
  textInputError: {
    borderColor: Colors.error.DEFAULT,
  },
  errorText: {
    color: Colors.error.DEFAULT,
    fontSize: 14,
    marginTop: Spacing.xs,
  },
  textArea: {
    height: 80,
    textAlignVertical: "top",
  },
  visibilityRow: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  visibilityOption: {
    flex: 1,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.surface.border,
    alignItems: "center",
    backgroundColor: Colors.surface.primary,
  },
  visibilityOptionSelected: {
    backgroundColor: Colors.primary.DEFAULT + "20",
    borderColor: Colors.primary.DEFAULT,
  },
  visibilityOptionText: {
    ...Typography.body2,
    color: Colors.text.secondary,
    fontWeight: "600",
  },
  visibilityOptionTextSelected: {
    color: Colors.primary.DEFAULT,
  },
  ownerToggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.surface.border,
    backgroundColor: Colors.surface.primary,
  },
  ownerToggleCopy: {
    flex: 1,
  },
  ownerToggleTitle: {
    ...Typography.body1,
    fontWeight: "600",
    color: Colors.text.primary,
  },
  ownerToggleSub: {
    ...Typography.caption,
    color: Colors.text.secondary,
    marginTop: 2,
  },
  addExerciseButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.primary.DEFAULT + "20",
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.primary.DEFAULT,
  },
  addExerciseButtonText: {
    ...Typography.body2,
    color: Colors.primary.DEFAULT,
    marginLeft: Spacing.xs,
    fontWeight: "600",
  },
  emptyExercises: {
    alignItems: "center",
    paddingVertical: Spacing.xl,
  },
  emptyExercisesTitle: {
    ...Typography.h3,
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
  },
  emptyExercisesTitleError: {
    color: Colors.error.DEFAULT,
  },
  emptyExercisesMessage: {
    ...Typography.body2,
    textAlign: "center",
    color: Colors.text.secondary,
  },
  exercisesList: {
    gap: Spacing.sm,
  },
  saveButton: {
    backgroundColor: Colors.primary.DEFAULT,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
    alignItems: "center",
    justifyContent: "center",
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    ...Typography.body1,
    color: Colors.text.primary,
    fontWeight: "600",
  },
});
