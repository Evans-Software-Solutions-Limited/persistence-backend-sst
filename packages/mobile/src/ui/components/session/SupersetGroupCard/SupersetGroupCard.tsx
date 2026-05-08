/**
 * SupersetGroupCard — wraps two-or-more `SessionExerciseCard`s
 * sharing the same `supersetGroup` into a single visual grouped
 * card with a top "SUPERSET" badge and a shared "Add Set" button at
 * the bottom that adds row N to every peer at once. (M3, Story-005.)
 *
 * Simplified port of legacy
 * `persistence-mobile/components/workouts/ActiveSupersetRow`. Legacy
 * interleaves columns per setNumber; we keep the simpler vertical
 * stack of per-exercise cards bracketed by a left rail + Add Set
 * footer. Same paired-logging contract — Add Set fires
 * `addSupersetSetCommand({ sessionExerciseIds })` so all peers gain
 * a setNumber together.
 */

import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SessionExerciseCard } from "../SessionExerciseCard";
import {
  BorderRadius,
  Colors,
  Spacing,
  Typography,
} from "@/ui/theme/workoutsLegacyTheme";
import type { ExerciseSet, SessionExercise } from "@/domain/models/session";

export type SupersetGroupCardProps = {
  supersetGroup: number;
  exercises: SessionExercise[];
  previousByExercise: Record<string, { weightKg: number; reps: number } | null>;
  onLogSupersetSet: (sessionExerciseIds: readonly string[]) => void;
  onUpdateSet: (
    sessionExerciseId: string,
    setId: string,
    patch: Partial<Pick<ExerciseSet, "weightKg" | "reps" | "rpe">>,
  ) => void;
  onRemoveSet: (sessionExerciseId: string, setId: string) => void;
  onOpenNotes: (sessionExerciseId: string) => void;
  onSubstitute: (sessionExerciseId: string) => void;
  onRemoveExercise: (sessionExerciseId: string) => void;
  onTapExercise: (exerciseId: string) => void;
};

export function SupersetGroupCard(props: SupersetGroupCardProps) {
  const exerciseIds = props.exercises.map((ex) => ex.id);
  const setCount = props.exercises.reduce(
    (max, ex) => Math.max(max, ex.sets.length),
    0,
  );

  return (
    <View
      style={styles.wrapper}
      testID={`superset-group-${props.supersetGroup}`}
    >
      <View style={styles.badgeRow}>
        <View style={styles.badgeLine} />
        <View style={styles.badge}>
          <Text style={styles.badgeText}>
            SUPERSET · {props.exercises.length} EXERCISES · {setCount} SET
            {setCount === 1 ? "" : "S"}
          </Text>
        </View>
        <View style={styles.badgeLine} />
      </View>

      <View style={styles.body}>
        {props.exercises.map((ex) => (
          <SessionExerciseCard
            key={ex.id}
            exercise={ex}
            previous={props.previousByExercise[ex.id] ?? null}
            // Tapping Add Set on a single card inside a superset
            // adds row N to ALL peers at once — paired logging.
            onLogSet={() => props.onLogSupersetSet(exerciseIds)}
            onUpdateSet={(setId, patch) =>
              props.onUpdateSet(ex.id, setId, patch)
            }
            onRemoveSet={(setId) => props.onRemoveSet(ex.id, setId)}
            onOpenNotes={() => props.onOpenNotes(ex.id)}
            onSubstitute={() => props.onSubstitute(ex.id)}
            onRemoveExercise={() => props.onRemoveExercise(ex.id)}
            onTapExercise={() => props.onTapExercise(ex.exerciseId)}
          />
        ))}
      </View>

      <TouchableOpacity
        onPress={() => props.onLogSupersetSet(exerciseIds)}
        style={styles.addSetButton}
        testID={`superset-${props.supersetGroup}-add-set`}
        accessibilityLabel="Add a paired set to every exercise in this superset"
      >
        <Ionicons name="add" size={20} color={Colors.primary.DEFAULT} />
        <Text style={styles.addSetText}>Add paired set</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    borderWidth: 1,
    borderColor: Colors.primary.DEFAULT,
    borderRadius: BorderRadius.md,
    padding: Spacing.sm,
    gap: Spacing.sm,
    backgroundColor: Colors.surface.primary,
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  badgeLine: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.primary.DEFAULT,
    opacity: 0.4,
  },
  badge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
    backgroundColor: Colors.primary.DEFAULT,
  },
  badgeText: {
    ...Typography.caption,
    color: Colors.text.primary,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  body: {
    gap: Spacing.sm,
  },
  addSetButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.sm,
    gap: Spacing.xs,
    borderTopWidth: 1,
    borderTopColor: Colors.surface.border,
  },
  addSetText: {
    ...Typography.body2,
    color: Colors.primary.DEFAULT,
    fontWeight: "600",
  },
});
