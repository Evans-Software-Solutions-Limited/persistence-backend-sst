/**
 * ActiveSupersetExerciseRow — the per-peer mini-row inside one
 * `SET N` block of `ActiveSupersetRow`.
 *
 * Ported 1:1 from `persistence-mobile/components/workouts/
 * ActiveSupersetRow/ActiveSupersetExerciseRow.tsx`. Four columns on a
 * row: exercise name (with swap + remove icons gated to setNumber=1
 * by the parent), previous-set chip, reps input, weight input.
 *
 * The parent `ActiveSupersetRow` finds the matching `ExerciseSet` per
 * (peer, setNumber) and passes it in as `currentSet`; this row stays
 * a presentation primitive and forwards `onUpdateSet` patches up.
 *
 * Spec: persistence-mobile/components/workouts/ActiveSupersetRow
 *       specs/05-active-session/requirements.md STORY-005
 */

import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import {
  BorderRadius,
  Colors,
  Spacing,
  Typography,
} from "@/ui/theme/workoutsLegacyTheme";
import type { ExerciseSet } from "@/domain/models/session";

export type ActiveSupersetExerciseRowProps = {
  exerciseName: string;
  sessionExerciseId: string;
  setNumber: number;
  currentSet?: ExerciseSet;
  previousSet?: { weightKg: number; reps: number };
  onUpdateSet: (patch: Partial<Pick<ExerciseSet, "weightKg" | "reps">>) => void;
  onFillPrevious: () => void;
  showSwap?: boolean;
  onSwap?: () => void;
  showRemove?: boolean;
  onRemove?: () => void;
};

export function ActiveSupersetExerciseRow({
  exerciseName,
  sessionExerciseId,
  setNumber,
  currentSet,
  previousSet,
  onUpdateSet,
  onFillPrevious,
  showSwap = false,
  onSwap,
  showRemove = false,
  onRemove,
}: ActiveSupersetExerciseRowProps) {
  const [repsValue, setRepsValue] = useState(
    currentSet?.reps != null ? String(currentSet.reps) : "",
  );
  const [weightValue, setWeightValue] = useState(
    currentSet?.weightKg != null ? String(currentSet.weightKg) : "",
  );

  // Reset local state when the underlying set data changes (e.g. after
  // tapping the previous-set chip to fill values, or after a paired
  // remove renumbers the surviving sets).
  useEffect(() => {
    setRepsValue(currentSet?.reps != null ? String(currentSet.reps) : "");
    setWeightValue(
      currentSet?.weightKg != null ? String(currentSet.weightKg) : "",
    );
  }, [currentSet?.reps, currentSet?.weightKg]);

  const handleRepsChange = (text: string) => {
    setRepsValue(text);
    if (text === "") {
      onUpdateSet({ reps: null });
      return;
    }
    const parsed = Number.parseInt(text, 10);
    if (!Number.isNaN(parsed)) onUpdateSet({ reps: parsed });
  };

  const handleWeightChange = (text: string) => {
    setWeightValue(text);
    if (text === "") {
      onUpdateSet({ weightKg: null });
      return;
    }
    const parsed = Number.parseFloat(text);
    if (!Number.isNaN(parsed)) onUpdateSet({ weightKg: parsed });
  };

  return (
    <View
      style={styles.row}
      testID={`superset-row-${sessionExerciseId}-${setNumber}`}
    >
      <View style={[styles.column, styles.columnExercise]}>
        <Text
          style={styles.exerciseName}
          numberOfLines={2}
          ellipsizeMode="tail"
        >
          {exerciseName}
        </Text>
        {showSwap && onSwap && (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`Swap ${exerciseName}`}
            onPress={onSwap}
            style={styles.swapButton}
            testID={`superset-row-${sessionExerciseId}-swap`}
          >
            <Ionicons
              name="swap-horizontal"
              size={18}
              color={Colors.text.secondary}
            />
          </TouchableOpacity>
        )}
        {showRemove && onRemove && (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`Remove ${exerciseName}`}
            onPress={onRemove}
            style={styles.removeButton}
            testID={`superset-row-${sessionExerciseId}-remove-exercise`}
          >
            <Ionicons
              name="trash-outline"
              size={18}
              color={Colors.error.DEFAULT}
            />
          </TouchableOpacity>
        )}
      </View>

      <View style={[styles.column, styles.columnPrevious]}>
        {previousSet ? (
          <TouchableOpacity
            onPress={onFillPrevious}
            testID={`superset-row-${sessionExerciseId}-${setNumber}-previous`}
          >
            <Text style={styles.previousText}>
              {previousSet.reps} reps • {previousSet.weightKg} kg
            </Text>
          </TouchableOpacity>
        ) : (
          <Text style={styles.previousPlaceholder}>-</Text>
        )}
      </View>

      <TextInput
        style={[styles.input, styles.column, styles.columnReps]}
        value={repsValue}
        onChangeText={handleRepsChange}
        keyboardType="number-pad"
        returnKeyType="next"
        placeholder="-"
        placeholderTextColor={Colors.text.tertiary}
        testID={`superset-row-${sessionExerciseId}-${setNumber}-reps`}
      />

      <TextInput
        style={[styles.input, styles.column, styles.columnWeight]}
        value={weightValue}
        onChangeText={handleWeightChange}
        keyboardType="decimal-pad"
        returnKeyType="done"
        placeholder="-"
        placeholderTextColor={Colors.text.tertiary}
        testID={`superset-row-${sessionExerciseId}-${setNumber}-weight`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    gap: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surface.border,
  },
  column: {
    justifyContent: "center",
  },
  columnExercise: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    flex: 3,
  },
  exerciseName: {
    ...Typography.body2,
    color: Colors.text.primary,
    flex: 1,
    flexShrink: 1,
    textAlign: "left",
  },
  swapButton: { padding: Spacing.xs },
  removeButton: { padding: Spacing.xs },
  columnPrevious: {
    flex: 2.5,
    alignItems: "center",
  },
  previousText: {
    ...Typography.body2,
    color: Colors.primary.DEFAULT,
    fontWeight: "600",
    textAlign: "center",
  },
  previousPlaceholder: {
    ...Typography.body2,
    color: Colors.text.tertiary,
    textAlign: "center",
  },
  input: {
    backgroundColor: Colors.surface.secondary,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: Colors.surface.border,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    ...Typography.body2,
    color: Colors.text.primary,
    textAlign: "center",
  },
  columnReps: { flex: 1 },
  columnWeight: { flex: 1 },
});
