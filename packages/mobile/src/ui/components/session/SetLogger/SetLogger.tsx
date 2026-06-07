/**
 * SetLogger — single-set entry row, 1:1 port of legacy
 * `persistence-mobile/components/workouts/ActiveSetRow/ActiveSetRow.tsx`.
 *
 * Layout: SET # | Previous (tap-to-fill) | reps | kg | trash. Trash is
 * always visible (legacy `:94-99`) — there is no Mark-Complete affordance
 * in legacy and the V2 redesign that gated trash behind isCompleted is
 * removed. RPE input is also removed; legacy has only reps + weight.
 *
 * Spec: persistence-mobile/components/workouts/ActiveSetRow/ActiveSetRow.tsx
 */

import React, { useEffect, useRef, useState } from "react";
import {
  Keyboard,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { styles } from "./styles";
import { IconX } from "@/ui/components/icons";
import { color } from "@/ui/theme/tokens";
import type { ExerciseSet } from "@/domain/models/session";

export type SetLoggerProps = {
  set: ExerciseSet;
  /** 1-based display position. */
  setNumber: number;
  /** Weight + reps from the previous set on the same exercise (for quick-fill). */
  previous: { weightKg: number; reps: number } | null;
  onChange: (patch: Partial<Pick<ExerciseSet, "weightKg" | "reps">>) => void;
  onRemove: () => void;
  onFillPrevious: () => void;
};

const toInputString = (n: number | null): string =>
  n == null ? "" : n.toString();

export function SetLogger(props: SetLoggerProps) {
  const [reps, setReps] = useState(toInputString(props.set.reps));
  const [weight_kg, setWeightKg] = useState(toInputString(props.set.weightKg));
  const weightInputRef = useRef<TextInput | null>(null);

  useEffect(() => {
    setReps(toInputString(props.set.reps));
    setWeightKg(toInputString(props.set.weightKg));
  }, [props.set.reps, props.set.weightKg]);

  const handleRepsChange = (text: string) => {
    setReps(text);
    if (text === "") return props.onChange({ reps: null });
    const n = Number.parseInt(text, 10);
    if (!Number.isNaN(n)) props.onChange({ reps: n });
  };

  const handleWeightChange = (text: string) => {
    setWeightKg(text);
    if (text === "") return props.onChange({ weightKg: null });
    const n = Number.parseFloat(text);
    if (!Number.isNaN(n)) props.onChange({ weightKg: n });
  };

  return (
    <View style={styles.row} testID={`set-logger-${props.set.id}`}>
      <Text style={styles.setNumber}>{props.setNumber}</Text>

      {props.previous ? (
        <TouchableOpacity
          onPress={props.onFillPrevious}
          style={styles.previousContainer}
          testID="set-logger-fill-previous"
        >
          <Text style={styles.previousText}>
            {props.previous.reps} reps • {props.previous.weightKg} kg
          </Text>
        </TouchableOpacity>
      ) : (
        <Text style={styles.previousDisabled}>—</Text>
      )}

      <TextInput
        style={[styles.input, styles.repsInput]}
        value={reps}
        onChangeText={handleRepsChange}
        keyboardType="number-pad"
        returnKeyType="next"
        // `blurOnSubmit={false}` keeps the keyboard open across the
        // reps → weight focus hop. The default is `true` for single-
        // line TextInputs, which blurs the field on submit BEFORE the
        // onSubmitEditing callback transfers focus — iOS sees a no-
        // focused-input window and dismisses the keyboard, then re-
        // shows it when the weight input gains focus, producing a
        // visible content jump-down-and-back-up.
        blurOnSubmit={false}
        onSubmitEditing={() => weightInputRef.current?.focus()}
        testID="set-logger-reps"
      />

      <TextInput
        ref={weightInputRef}
        style={[styles.input, styles.weightInput]}
        value={weight_kg}
        onChangeText={handleWeightChange}
        keyboardType="decimal-pad"
        returnKeyType="done"
        // Weight is the last field in the chain, so the default
        // `blurOnSubmit={true}` is correct here — Return/Done should
        // close the keyboard, and the explicit `Keyboard.dismiss` call
        // belt-and-braces this on the platforms where blurring alone
        // doesn't suffice.
        onSubmitEditing={Keyboard.dismiss}
        testID="set-logger-weight"
      />

      <View style={styles.trashContainer}>
        <TouchableOpacity
          onPress={props.onRemove}
          testID="set-logger-remove"
          accessibilityLabel="Remove set"
        >
          <IconX size={12} color={color.$error} />
        </TouchableOpacity>
      </View>
    </View>
  );
}
