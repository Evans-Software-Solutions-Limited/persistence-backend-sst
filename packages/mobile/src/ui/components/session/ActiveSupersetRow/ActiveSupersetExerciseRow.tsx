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

import React, { useEffect, useState } from "react";
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { IconSwap, IconTrash } from "@/ui/components/icons";
import { GEIST_MONO_FAMILY } from "@/ui/theme/fonts";
import { color } from "@/ui/theme/tokens";
import type { ExerciseSet } from "@/domain/models/session";
import { weightInUnit, type WeightUnit } from "@/shared/utils";

export type ActiveSupersetExerciseRowProps = {
  exerciseName: string;
  sessionExerciseId: string;
  setNumber: number;
  currentSet?: ExerciseSet;
  previousSet?: { weightKg: number; reps: number };
  /**
   * Display-unit preference for the previous-set chip. The current-set
   * weight TextInput below is unaffected — it's an input surface (writes
   * kg), not a display label. Defaults to "kg".
   */
  weightUnit?: WeightUnit;
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
  weightUnit = "kg",
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
            <IconSwap size={15} color={color.$text3} />
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
            <IconTrash size={15} color={color.$error} />
          </TouchableOpacity>
        )}
      </View>

      <View style={[styles.column, styles.columnPrevious]}>
        {previousSet ? (
          <TouchableOpacity
            onPress={onFillPrevious}
            testID={`superset-row-${sessionExerciseId}-${setNumber}-previous`}
          >
            <Text
              style={styles.previousText}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {`${previousSet.reps} reps • ${weightInUnit(previousSet.weightKg, weightUnit)} ${weightUnit}`}
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
        placeholderTextColor={color.$text4}
        testID={`superset-row-${sessionExerciseId}-${setNumber}-reps`}
      />

      <TextInput
        style={[styles.input, styles.column, styles.columnWeight]}
        value={weightValue}
        onChangeText={handleWeightChange}
        keyboardType="decimal-pad"
        returnKeyType="done"
        placeholder="-"
        placeholderTextColor={color.$text4}
        testID={`superset-row-${sessionExerciseId}-${setNumber}-weight`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 8,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: color.$border,
  },
  column: {
    justifyContent: "center",
  },
  columnExercise: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flex: 3,
  },
  exerciseName: {
    fontSize: 14,
    fontWeight: "400",
    lineHeight: 20,
    color: color.$text,
    flex: 1,
    flexShrink: 1,
    textAlign: "left",
  },
  swapButton: { padding: 4 },
  removeButton: { padding: 4 },
  columnPrevious: {
    flex: 2.5,
    alignItems: "center",
  },
  previousText: {
    fontFamily: GEIST_MONO_FAMILY,
    fontSize: 12,
    fontWeight: "600",
    color: color.$primary,
    textAlign: "center",
  },
  previousPlaceholder: {
    fontFamily: GEIST_MONO_FAMILY,
    fontSize: 12,
    color: color.$text4,
    textAlign: "center",
  },
  input: {
    backgroundColor: color.$surface2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: color.$border,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontFamily: GEIST_MONO_FAMILY,
    fontSize: 13,
    color: color.$text,
    textAlign: "center",
  },
  // Fixed-width fields (not greedy flex) — same fix as the normal set row, so
  // the inputs don't balloon and the exercise/PREV columns keep their room.
  columnReps: { width: 62 },
  columnWeight: { width: 62 },
});
