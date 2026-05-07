/**
 * SessionExerciseCard — exercise header + list of SetLogger rows +
 * "+ Add set" button + inline action buttons (Notes, Substitute,
 * Remove). (M3, Story-002 / Story-004.)
 *
 * Ported from persistence-mobile/components/workouts/ActiveExerciseRow
 * with the V2 Container/Presenter shape — all mutation handlers come
 * in as props from the container. The three action buttons (Notes /
 * Swap / Trash) match legacy line 73-89.
 */

import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { ExerciseProgress } from "../ExerciseProgress";
import { QuickFillSuggestion } from "../QuickFillSuggestion";
import { SetLogger } from "../SetLogger";
import { styles } from "./styles";
import { Colors } from "@/ui/theme/workoutsLegacyTheme";
import type { ExerciseSet, SessionExercise } from "@/domain/models/session";

export type SessionExerciseCardProps = {
  exercise: SessionExercise;
  /** Last completed set on this exercise, in the active session. */
  previous: { weightKg: number; reps: number } | null;
  onLogSet: () => void;
  onCompleteSet: (setId: string) => void;
  onUpdateSet: (
    setId: string,
    patch: Partial<Pick<ExerciseSet, "weightKg" | "reps" | "rpe">>,
  ) => void;
  onRemoveSet: (setId: string) => void;
  onOpenNotes: () => void;
  onSubstitute: () => void;
  onRemoveExercise: () => void;
  onTapExercise: () => void;
};

export function SessionExerciseCard(props: SessionExerciseCardProps) {
  const completedCount = props.exercise.sets.filter(
    (s) => s.isCompleted,
  ).length;
  const showQuickFill =
    props.previous != null &&
    props.exercise.sets.some(
      (s) => !s.isCompleted && s.weightKg == null && s.reps == null,
    );

  return (
    <View
      style={[
        styles.card,
        props.exercise.isSubstituted && styles.cardSubstituted,
      ]}
      testID={`session-exercise-${props.exercise.id}`}
    >
      <View style={styles.header}>
        <TouchableOpacity
          onPress={props.onTapExercise}
          style={styles.headerLeft}
          testID="session-exercise-tap"
          accessibilityLabel={`Open ${props.exercise.exerciseName} details`}
        >
          <Text style={styles.title} numberOfLines={1}>
            {props.exercise.exerciseName}
          </Text>
          {props.exercise.isSubstituted && (
            <View style={styles.substitutedBadge}>
              <Text style={styles.substitutedText}>Substituted</Text>
            </View>
          )}
        </TouchableOpacity>

        <ExerciseProgress
          setsCompleted={completedCount}
          totalSets={props.exercise.sets.length}
        />

        <View style={styles.actionsRow}>
          <TouchableOpacity
            onPress={props.onOpenNotes}
            style={styles.menuButton}
            testID="session-exercise-notes"
            accessibilityLabel={
              props.exercise.notes ? "Edit notes" : "Add notes"
            }
          >
            <Ionicons
              name="create-outline"
              size={20}
              color={
                props.exercise.notes
                  ? Colors.primary.DEFAULT
                  : Colors.text.secondary
              }
            />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={props.onSubstitute}
            style={styles.menuButton}
            testID="session-exercise-substitute"
            accessibilityLabel="Substitute exercise"
          >
            <Ionicons
              name="swap-horizontal-outline"
              size={20}
              color={Colors.text.secondary}
            />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={props.onRemoveExercise}
            style={styles.menuButton}
            testID="session-exercise-remove"
            accessibilityLabel="Remove exercise"
          >
            <Ionicons
              name="trash-outline"
              size={20}
              color={Colors.error.DEFAULT}
            />
          </TouchableOpacity>
        </View>
      </View>

      {showQuickFill && props.previous && (
        <QuickFillSuggestion
          weightKg={props.previous.weightKg}
          reps={props.previous.reps}
          onFill={() => {
            const target = props.exercise.sets.find(
              (s) => !s.isCompleted && s.weightKg == null && s.reps == null,
            );
            if (target && props.previous) {
              props.onUpdateSet(target.id, {
                weightKg: props.previous.weightKg,
                reps: props.previous.reps,
              });
            }
          }}
        />
      )}

      {props.exercise.sets.map((set, idx) => (
        <SetLogger
          key={set.id}
          set={set}
          setNumber={idx + 1}
          previous={idx === 0 ? props.previous : null}
          onChange={(patch) => props.onUpdateSet(set.id, patch)}
          onComplete={() => props.onCompleteSet(set.id)}
          onRemove={() => props.onRemoveSet(set.id)}
          onFillPrevious={() => {
            if (props.previous) {
              props.onUpdateSet(set.id, {
                weightKg: props.previous.weightKg,
                reps: props.previous.reps,
              });
            }
          }}
        />
      ))}

      <TouchableOpacity
        onPress={props.onLogSet}
        style={styles.addSetButton}
        testID="session-exercise-add-set"
        accessibilityLabel="Add a set"
      >
        <Ionicons name="add" size={20} color={Colors.primary.DEFAULT} />
        <Text style={styles.addSetText}>Add set</Text>
      </TouchableOpacity>
    </View>
  );
}
