/**
 * SetLogger — single-set entry row. Weight + reps + RPE inputs +
 * Mark Complete (M3, Story-002).
 *
 * Form state in snake_case at the component, camelCase at the
 * boundary (M2 learning #6) — mirrors the legacy
 * persistence-mobile/components/workouts/ActiveSetRow component
 * shape. Falsy-zero safe (M2 learning #8): every numeric value
 * (weight, reps, RPE) can validly be 0.
 *
 * Spec: specs/05-active-session/requirements.md STORY-002
 *       persistence-mobile/components/workouts/ActiveSetRow/ActiveSetRow.tsx (legacy port)
 */

import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
  Keyboard,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { styles } from "./styles";
import { Colors } from "@/ui/theme/workoutsLegacyTheme";
import type { ExerciseSet } from "@/domain/models/session";

export type SetLoggerProps = {
  set: ExerciseSet;
  /** 1-based display position. */
  setNumber: number;
  /** Weight + reps from the previous set on the same exercise (for quick-fill). */
  previous: { weightKg: number; reps: number } | null;
  onChange: (
    patch: Partial<Pick<ExerciseSet, "weightKg" | "reps" | "rpe">>,
  ) => void;
  onComplete: () => void;
  onRemove: () => void;
  onFillPrevious: () => void;
};

const toInputString = (n: number | null): string => {
  if (n == null) return "";
  return Number.isInteger(n) ? n.toString() : n.toString();
};

export function SetLogger(props: SetLoggerProps) {
  // Snake-case form state mirrors the legacy ActiveSetRow shape.
  const [weight_kg, setWeightKg] = useState(toInputString(props.set.weightKg));
  const [reps, setReps] = useState(toInputString(props.set.reps));
  const [rpe, setRpe] = useState(toInputString(props.set.rpe));

  useEffect(() => {
    setWeightKg(toInputString(props.set.weightKg));
    setReps(toInputString(props.set.reps));
    setRpe(toInputString(props.set.rpe));
  }, [props.set.weightKg, props.set.reps, props.set.rpe]);

  const handleWeightChange = (text: string) => {
    setWeightKg(text);
    if (text === "") return props.onChange({ weightKg: null });
    const n = Number.parseFloat(text);
    if (!Number.isNaN(n)) props.onChange({ weightKg: n });
  };

  const handleRepsChange = (text: string) => {
    setReps(text);
    if (text === "") return props.onChange({ reps: null });
    const n = Number.parseInt(text, 10);
    if (!Number.isNaN(n)) props.onChange({ reps: n });
  };

  const handleRpeChange = (text: string) => {
    setRpe(text);
    if (text === "") return props.onChange({ rpe: null });
    const n = Number.parseInt(text, 10);
    if (!Number.isNaN(n) && n >= 1 && n <= 10) {
      props.onChange({ rpe: n });
    }
  };

  return (
    <View
      style={[styles.row, props.set.isCompleted && styles.rowCompleted]}
      testID={`set-logger-${props.set.id}`}
    >
      <Text style={styles.setNumber}>{props.setNumber}</Text>

      {props.previous ? (
        <TouchableOpacity
          onPress={props.onFillPrevious}
          style={styles.previousContainer}
          testID="set-logger-fill-previous"
        >
          <Text style={styles.previousText}>
            {props.previous.weightKg}kg × {props.previous.reps}
          </Text>
        </TouchableOpacity>
      ) : (
        <Text style={styles.previousDisabled}>—</Text>
      )}

      <TextInput
        style={[styles.input, styles.weightInput]}
        value={weight_kg}
        onChangeText={handleWeightChange}
        keyboardType="decimal-pad"
        placeholder="kg"
        placeholderTextColor={Colors.text.tertiary}
        editable={!props.set.isCompleted}
        testID="set-logger-weight"
      />

      <TextInput
        style={[styles.input, styles.repsInput]}
        value={reps}
        onChangeText={handleRepsChange}
        keyboardType="number-pad"
        placeholder="reps"
        placeholderTextColor={Colors.text.tertiary}
        editable={!props.set.isCompleted}
        testID="set-logger-reps"
      />

      <TextInput
        style={[styles.input, styles.rpeInput]}
        value={rpe}
        onChangeText={handleRpeChange}
        keyboardType="number-pad"
        placeholder="RPE"
        placeholderTextColor={Colors.text.tertiary}
        editable={!props.set.isCompleted}
        onSubmitEditing={Keyboard.dismiss}
        testID="set-logger-rpe"
      />

      <TouchableOpacity
        onPress={props.set.isCompleted ? props.onRemove : props.onComplete}
        style={[
          styles.actionButton,
          props.set.isCompleted && styles.actionButtonCompleted,
        ]}
        testID="set-logger-action"
        accessibilityLabel={
          props.set.isCompleted ? "Remove set" : "Mark set complete"
        }
      >
        <Ionicons
          name={
            props.set.isCompleted ? "trash-outline" : "checkmark-circle-outline"
          }
          size={22}
          color={
            props.set.isCompleted
              ? Colors.error.DEFAULT
              : Colors.success.DEFAULT
          }
        />
      </TouchableOpacity>
    </View>
  );
}
