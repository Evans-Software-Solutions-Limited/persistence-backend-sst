import {
  BorderRadius,
  Colors,
  Spacing,
  Typography,
} from "@/ui/theme/workoutsLegacyTheme";
import { AddExercisePopover } from "@/ui/components/workouts/AddExercisePopover";
import { ExerciseConfigCard } from "@/ui/components/workouts/ExerciseConfigCard";
import type {
  WorkoutFormExercise,
  WorkoutFormState,
} from "@/ui/hooks/useWorkoutForm";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

interface WorkoutCreatorPresenterProps {
  readonly formState: WorkoutFormState;
  readonly isSubmitting: boolean;
  readonly hasAttemptedSubmit: boolean;
  readonly submitError: string | null;
  readonly pickerVisible: boolean;
  readonly onSetName: (value: string) => void;
  readonly onSetDescription: (value: string) => void;
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

export function WorkoutCreatorPresenter({
  formState,
  isSubmitting,
  hasAttemptedSubmit,
  submitError,
  pickerVisible,
  onSetName,
  onSetDescription,
  onAddExerciseTap,
  onClosePicker,
  onAddExercises,
  onAddSuperset,
  onRemoveExercise,
  onExerciseConfigChange,
  onSubmit,
  onCancel,
}: WorkoutCreatorPresenterProps) {
  const exercises = formState.exercises;
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
              testID="creator-back-button"
            >
              <Ionicons
                name="arrow-back"
                size={24}
                color={Colors.text.primary}
              />
            </TouchableOpacity>
            <Text style={styles.screenTitle}>Create Workout</Text>
            <View style={styles.placeholder} />
          </View>

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
                  style={[styles.textInput, nameError && styles.textInputError]}
                  placeholder="Enter workout name"
                  placeholderTextColor={Colors.text.secondary}
                  value={formState.name}
                  onChangeText={onSetName}
                  testID="workout-name-input"
                />
                {nameError && <Text style={styles.errorText}>{nameError}</Text>}
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
                  <Text style={styles.addExerciseButtonText}>Add Exercise</Text>
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
                    Tap &quot;Add Exercise&quot; to browse and select exercises
                    for your workout
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
                  {isSubmitting ? "Saving…" : "Save Workout"}
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
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
  scrollContentContainer: {
    flexGrow: 1,
    paddingBottom: Spacing.xl,
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
