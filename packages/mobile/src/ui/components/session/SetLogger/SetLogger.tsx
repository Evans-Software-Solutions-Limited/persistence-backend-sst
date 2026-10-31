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
import {
  weightInUnit,
  weightInputToKg,
  weightToInputText,
  type WeightUnit,
} from "@/shared/utils";
import {
  activityDistanceFromMeters,
  activityDistanceToMeters,
  formatDurationInput,
  jumpDistanceFromMeters,
  jumpDistanceToMeters,
  parseDurationInput,
} from "@/shared/utils/activityUnits";

/** Delivery of a set logged for someone else (PER-60 partner view). */
export type SetSyncState = "saved" | "sending" | "notsent" | "none";

const SYNC_DOT: Record<SetSyncState, { color: string; label: string }> = {
  saved: { color: color.$success, label: "Saved" },
  sending: { color: color.$primary, label: "Sending" },
  notsent: { color: color.$ember, label: "Not sent" },
  none: { color: color.$surface3, label: "Not logged" },
};

export type SetLoggerProps = {
  readOnly?: boolean;
  hideRemove?: boolean;
  /** Draws the canvas status dot beside the set number. Absent on your own sets. */
  syncState?: SetSyncState;
  /** Called when reps or weight loses focus. */
  onCommit?: () => void;
  set: ExerciseSet;
  /** 1-based display position. */
  setNumber: number;
  /** Weight + reps from the previous set on the same exercise (for quick-fill). */
  previous: { weightKg: number; reps: number } | null;
  /**
   * Display-unit preference for the previous-set chip AND the weight input,
   * which shows and accepts the weight in this unit and stores kg (PER-98:
   * the column header already said LB while the field read and wrote kg).
   * Defaults to "kg".
   */
  weightUnit?: WeightUnit;
  preferredUnits?: "metric" | "imperial";
  trackingMode?: "strength" | "cardio" | "plyometric";
  onChange: (
    patch: Partial<
      Pick<
        ExerciseSet,
        "weightKg" | "reps" | "durationSeconds" | "distanceMeters"
      >
    >,
  ) => void;
  onRemove: () => void;
  onFillPrevious: () => void;
};

const toInputString = (n: number | null): string =>
  n == null ? "" : n.toString();

export function SetLogger(props: SetLoggerProps) {
  const weightUnit = props.weightUnit ?? "kg";
  const preferredUnits = props.preferredUnits ?? "metric";
  const trackingMode = props.trackingMode ?? "strength";
  const [reps, setReps] = useState(toInputString(props.set.reps));
  const [weightText, setWeightText] = useState(() =>
    weightToInputText(props.set.weightKg, weightUnit),
  );
  const [duration, setDuration] = useState(
    formatDurationInput(props.set.durationSeconds),
  );
  const [distance, setDistance] = useState(() => {
    if (props.set.distanceMeters == null) return "";
    const value =
      trackingMode === "plyometric"
        ? jumpDistanceFromMeters(props.set.distanceMeters, preferredUnits)
        : activityDistanceFromMeters(props.set.distanceMeters, preferredUnits);
    return Number(value.toFixed(2)).toString();
  });
  const weightInputRef = useRef<TextInput | null>(null);
  const durationInputFocusedRef = useRef(false);
  const distanceInputFocusedRef = useRef(false);

  useEffect(() => {
    setReps(toInputString(props.set.reps));
    // Keep what the user is typing ("100.") when it already means the
    // stored kg; otherwise show the stored weight in the display unit.
    setWeightText((current) =>
      weightInputToKg(current, weightUnit) === props.set.weightKg
        ? current
        : weightToInputText(props.set.weightKg, weightUnit),
    );
  }, [props.set.reps, props.set.weightKg, weightUnit]);

  useEffect(() => {
    // Commands echo each valid keystroke back through SQLite. Do not replace
    // the user's in-progress text (for example `2`, `25:3`, `1.`) with that
    // canonical echo while the field is focused; canonicalise on blur instead.
    if (!durationInputFocusedRef.current) {
      setDuration(formatDurationInput(props.set.durationSeconds));
    }
    if (distanceInputFocusedRef.current) return;
    if (props.set.distanceMeters == null) {
      setDistance("");
    } else {
      const value =
        trackingMode === "plyometric"
          ? jumpDistanceFromMeters(props.set.distanceMeters, preferredUnits)
          : activityDistanceFromMeters(
              props.set.distanceMeters,
              preferredUnits,
            );
      setDistance(Number(value.toFixed(2)).toString());
    }
  }, [
    preferredUnits,
    props.set.distanceMeters,
    props.set.durationSeconds,
    trackingMode,
  ]);

  const handleRepsChange = (text: string) => {
    setReps(text);
    if (text === "") return props.onChange({ reps: null });
    const n = Number.parseInt(text, 10);
    if (!Number.isNaN(n)) props.onChange({ reps: n });
  };

  const handleWeightChange = (text: string) => {
    setWeightText(text);
    if (text === "") return props.onChange({ weightKg: null });
    const kg = weightInputToKg(text, weightUnit);
    if (kg !== null) props.onChange({ weightKg: kg });
  };

  const handleDurationChange = (text: string) => {
    setDuration(text);
    if (text === "") return props.onChange({ durationSeconds: null });
    const seconds = parseDurationInput(text);
    props.onChange({ durationSeconds: seconds });
  };

  const handleDistanceChange = (text: string) => {
    setDistance(text);
    if (text === "") return props.onChange({ distanceMeters: null });
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) {
      return props.onChange({ distanceMeters: null });
    }
    const value = Number(text);
    if (!Number.isFinite(value))
      return props.onChange({ distanceMeters: null });
    props.onChange({
      distanceMeters:
        trackingMode === "plyometric"
          ? jumpDistanceToMeters(value, preferredUnits)
          : activityDistanceToMeters(value, preferredUnits),
    });
  };

  return (
    <View style={styles.row} testID={`set-logger-${props.set.id}`}>
      {props.syncState ? (
        <View style={[styles.setNumber, styles.setNumberWithDot]}>
          <View
            style={[
              styles.syncDot,
              { backgroundColor: SYNC_DOT[props.syncState].color },
            ]}
            accessibilityRole="image"
            accessibilityLabel={SYNC_DOT[props.syncState].label}
            testID={`set-logger-sync-${props.syncState}`}
          />
          <Text style={styles.setNumberText}>{props.setNumber}</Text>
        </View>
      ) : (
        <Text style={styles.setNumber}>{props.setNumber}</Text>
      )}

      {props.previous ? (
        <TouchableOpacity
          disabled={props.readOnly}
          onPress={props.readOnly ? undefined : props.onFillPrevious}
          style={styles.previousContainer}
          testID="set-logger-fill-previous"
        >
          <Text
            style={styles.previousText}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {`${props.previous.reps} reps • ${weightInUnit(props.previous.weightKg, weightUnit)} ${weightUnit}`}
          </Text>
        </TouchableOpacity>
      ) : (
        <Text style={styles.previousDisabled}>—</Text>
      )}

      <TextInput
        editable={!props.readOnly}
        style={[styles.input, styles.repsInput]}
        value={trackingMode === "cardio" ? duration : reps}
        onChangeText={
          props.readOnly
            ? undefined
            : trackingMode === "cardio"
              ? handleDurationChange
              : handleRepsChange
        }
        keyboardType={
          trackingMode === "cardio" ? "numbers-and-punctuation" : "number-pad"
        }
        placeholder={trackingMode === "cardio" ? "mm:ss" : undefined}
        onFocus={() => {
          durationInputFocusedRef.current = trackingMode === "cardio";
        }}
        onBlur={() => {
          durationInputFocusedRef.current = false;
          props.onCommit?.();
          if (trackingMode === "cardio") {
            setDuration(formatDurationInput(props.set.durationSeconds));
          }
        }}
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
        testID={
          trackingMode === "cardio" ? "set-logger-duration" : "set-logger-reps"
        }
      />

      <TextInput
        editable={!props.readOnly}
        ref={weightInputRef}
        style={[styles.input, styles.weightInput]}
        value={trackingMode === "strength" ? weightText : distance}
        onChangeText={
          props.readOnly
            ? undefined
            : trackingMode === "strength"
              ? handleWeightChange
              : handleDistanceChange
        }
        keyboardType="decimal-pad"
        onFocus={() => {
          distanceInputFocusedRef.current = trackingMode !== "strength";
        }}
        onBlur={() => {
          distanceInputFocusedRef.current = false;
          props.onCommit?.();
          if (trackingMode === "strength") return;
          if (props.set.distanceMeters == null) {
            setDistance("");
            return;
          }
          const value =
            trackingMode === "plyometric"
              ? jumpDistanceFromMeters(props.set.distanceMeters, preferredUnits)
              : activityDistanceFromMeters(
                  props.set.distanceMeters,
                  preferredUnits,
                );
          setDistance(Number(value.toFixed(2)).toString());
        }}
        returnKeyType="done"
        // Weight is the last field in the chain, so the default
        // `blurOnSubmit={true}` is correct here — Return/Done should
        // close the keyboard, and the explicit `Keyboard.dismiss` call
        // belt-and-braces this on the platforms where blurring alone
        // doesn't suffice.
        onSubmitEditing={Keyboard.dismiss}
        testID={
          trackingMode === "strength"
            ? "set-logger-weight"
            : "set-logger-distance"
        }
      />

      <View style={styles.trashContainer}>
        {!props.readOnly && !props.hideRemove && (
          <TouchableOpacity
            onPress={props.onRemove}
            testID="set-logger-remove"
            accessibilityLabel="Remove set"
          >
            <IconX size={12} color={color.$error} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}
