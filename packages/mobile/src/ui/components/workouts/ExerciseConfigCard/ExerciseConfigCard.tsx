import {
  BorderRadius,
  Colors,
  Spacing,
  Typography,
} from "@/ui/theme/workoutsLegacyTheme";
import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

interface ExerciseConfigCardProps {
  readonly exercise: any; // Using any to match the original
  readonly index: number;
  readonly onRemove: () => void;
  readonly onConfigChange: (field: string, value: number) => void;
  readonly isSupersetStart?: boolean;
  readonly isSupersetEnd?: boolean;
  readonly supersetGroupNumber?: number;
  /**
   * Display letter (A/B/C…) for the superset group, assigned by the parent in
   * appearance order so the badge matches the detail screen's centred pill.
   * Falls back to the raw group number if absent.
   */
  readonly supersetLetter?: string;

  readonly supersetLeadExercise?: any;
}

export default function ExerciseConfigCard({
  exercise,
  index,
  onRemove,
  onConfigChange,
  isSupersetStart = false,
  isSupersetEnd = false,
  supersetGroupNumber,
  supersetLetter,
  supersetLeadExercise,
}: ExerciseConfigCardProps) {
  const isInSuperset =
    isSupersetStart ||
    isSupersetEnd ||
    (exercise.superset_group !== undefined && exercise.superset_group !== null);
  const shouldDisableSharedFields = isInSuperset && !isSupersetStart;

  // Local state to avoid showing 0 when field is empty
  const [setsValue, setSetsValue] = useState(exercise.target_sets.toString());
  const [repsMinValue, setRepsMinValue] = useState(
    exercise.target_reps_min.toString(),
  );
  const [repsMaxValue, setRepsMaxValue] = useState(
    exercise.target_reps_max.toString(),
  );
  const [restValue, setRestValue] = useState(exercise.rest_seconds.toString());

  // Sync local state when exercise props change
  useEffect(() => {
    if (isInSuperset && !isSupersetStart && supersetLeadExercise) {
      // Mirror the lead exercise values for read-only fields
      setSetsValue(supersetLeadExercise.target_sets.toString());
      setRestValue(supersetLeadExercise.rest_seconds.toString());
    } else {
      setSetsValue(exercise.target_sets.toString());
      setRestValue(exercise.rest_seconds.toString());
    }
    setRepsMinValue(exercise.target_reps_min.toString());
    setRepsMaxValue(exercise.target_reps_max.toString());
  }, [
    exercise.target_sets,
    exercise.target_reps_min,
    exercise.target_reps_max,
    exercise.rest_seconds,
    isInSuperset,
    isSupersetStart,
    supersetLeadExercise,
  ]);

  return (
    <View style={styles.exerciseWrapper}>
      {/* Superset indicator — centred letter pill on a connector line
          (matches the detail screen). */}
      {isInSuperset && isSupersetStart && (
        <View style={styles.supersetConnector}>
          <View style={styles.supersetLine} />
          <View style={styles.supersetBadge}>
            <Ionicons
              name="layers-outline"
              size={10}
              color={Colors.text.inverse}
            />
            <Text style={styles.supersetBadgeText}>
              SUPERSET {supersetLetter ?? supersetGroupNumber}
            </Text>
          </View>
          <View style={styles.supersetLine} />
        </View>
      )}

      {/* Exercise Card */}
      <View
        style={[
          styles.exerciseConfigCard,
          isInSuperset && styles.exerciseConfigCardSuperset,
        ]}
      >
        <View style={styles.exerciseConfigHeader}>
          <View style={styles.exerciseConfigTitle}>
            <Text style={styles.exerciseConfigNumber}>{index + 1}</Text>
            <Text style={styles.exerciseConfigName}>
              {exercise.exercise_name}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.removeExerciseButton}
            onPress={onRemove}
            testID="remove-button"
          >
            <Ionicons
              name="trash-outline"
              size={18}
              color={Colors.error.DEFAULT}
            />
          </TouchableOpacity>
        </View>

        <View style={styles.exerciseConfigFields}>
          <View style={styles.configField}>
            <Text style={styles.configFieldLabel}>Sets</Text>
            <TextInput
              style={[
                styles.textInput,
                shouldDisableSharedFields && styles.textInputDisabled,
              ]}
              value={setsValue}
              onChangeText={setSetsValue}
              onBlur={() => {
                const num = parseInt(setsValue);
                if (
                  !Number.isNaN(num) &&
                  setsValue !== "" &&
                  !shouldDisableSharedFields
                ) {
                  onConfigChange("target_sets", num);
                } else if (setsValue === "" && !shouldDisableSharedFields) {
                  onConfigChange("target_sets", 0);
                }
              }}
              keyboardType="numeric"
              placeholder="3"
              editable={!shouldDisableSharedFields}
              testID="sets-input"
            />
            {shouldDisableSharedFields && (
              <Text style={styles.sharedConfigHint}>
                Inherited from superset
              </Text>
            )}
          </View>
          <View style={styles.configFieldWide}>
            <Text style={styles.configFieldLabel}>Rep Range</Text>
            <View style={styles.repRangeContainer}>
              <TextInput
                style={[styles.textInput, styles.repRangeInput]}
                value={repsMinValue}
                onChangeText={setRepsMinValue}
                onBlur={() => {
                  const num = parseInt(repsMinValue);
                  if (!isNaN(num) && repsMinValue !== "") {
                    onConfigChange("target_reps_min", num);
                  } else if (repsMinValue === "") {
                    onConfigChange("target_reps_min", 0);
                  }
                }}
                keyboardType="numeric"
                placeholder="8"
                testID="reps-min-input"
              />
              <Text style={styles.repRangeSeparator}>-</Text>
              <TextInput
                style={[styles.textInput, styles.repRangeInput]}
                value={repsMaxValue}
                onChangeText={setRepsMaxValue}
                onBlur={() => {
                  const num = parseInt(repsMaxValue);
                  if (!isNaN(num) && repsMaxValue !== "") {
                    onConfigChange("target_reps_max", num);
                  } else if (repsMaxValue === "") {
                    onConfigChange("target_reps_max", 0);
                  }
                }}
                keyboardType="numeric"
                placeholder="12"
                testID="reps-max-input"
              />
            </View>
          </View>
          <View style={styles.configField}>
            <Text style={styles.configFieldLabel}>Rest (s)</Text>
            <TextInput
              style={[
                styles.textInput,
                shouldDisableSharedFields && styles.textInputDisabled,
              ]}
              value={restValue}
              onChangeText={setRestValue}
              onBlur={() => {
                const num = parseInt(restValue);
                if (
                  !Number.isNaN(num) &&
                  restValue !== "" &&
                  !shouldDisableSharedFields
                ) {
                  onConfigChange("rest_seconds", num);
                } else if (restValue === "" && !shouldDisableSharedFields) {
                  onConfigChange("rest_seconds", 0);
                }
              }}
              keyboardType="numeric"
              placeholder="60"
              editable={!shouldDisableSharedFields}
              testID="rest-input"
            />
            {shouldDisableSharedFields && (
              <Text style={styles.sharedConfigHint}>
                Inherited from superset
              </Text>
            )}
          </View>
        </View>
      </View>

      {/* Superset connector line below - only for the last item */}
      {isInSuperset && isSupersetEnd && (
        <View style={styles.supersetConnectorBottom}>
          <View style={styles.supersetLine} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  exerciseWrapper: {
    marginBottom: Spacing.xs,
  },
  exerciseConfigCard: {
    padding: Spacing.md,
  },
  exerciseConfigCardSuperset: {
    borderLeftWidth: 3,
    borderLeftColor: Colors.primary.DEFAULT,
  },
  exerciseConfigHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.sm,
  },
  exerciseConfigTitle: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  exerciseConfigNumber: {
    ...Typography.h4,
    color: Colors.primary.DEFAULT,
    marginRight: Spacing.sm,
    minWidth: 24,
    fontWeight: "600",
  },
  exerciseConfigName: {
    ...Typography.body1,
    flex: 1,
    fontWeight: "500",
  },
  removeExerciseButton: {
    padding: Spacing.xs,
    marginLeft: Spacing.xs,
  },
  exerciseConfigFields: {
    flexDirection: "row",
    gap: Spacing.md,
    paddingLeft: Spacing.lg,
  },
  configField: {
    flex: 1,
  },
  configFieldWide: {
    flex: 1.5,
  },
  repRangeContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  repRangeSeparator: {
    ...Typography.body2,
    color: Colors.text.secondary,
    fontSize: 14,
    paddingHorizontal: Spacing.xs,
  },
  configFieldLabel: {
    ...Typography.caption,
    color: Colors.text.secondary,
    marginBottom: Spacing.xs,
  },
  // Shared input styling for all text inputs
  textInput: {
    backgroundColor: Colors.surface.primary,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: Colors.surface.border,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 8,
    ...Typography.body2,
    color: Colors.text.primary,
    textAlign: "center",
    fontSize: 14,
  },
  repRangeInput: {
    flex: 1,
  },
  textInputDisabled: {
    backgroundColor: Colors.surface.secondary,
    borderColor: Colors.surface.border,
    color: Colors.text.secondary,
  },
  sharedConfigHint: {
    ...Typography.caption,
    color: Colors.text.secondary,
    marginTop: Spacing.xs,
  },
  // Superset styling — centred letter pill on a connector line.
  supersetConnector: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.xs,
    marginHorizontal: Spacing.md,
  },
  supersetLine: {
    height: 2,
    flex: 1,
    borderRadius: 2,
    backgroundColor: Colors.primary.DEFAULT,
    opacity: 0.5,
  },
  supersetBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.primary.DEFAULT,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: BorderRadius.full,
  },
  supersetBadgeText: {
    ...Typography.caption,
    color: Colors.text.inverse,
    fontWeight: "700",
    fontSize: 10,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  supersetConnectorBottom: {
    marginTop: Spacing.xs,
    marginHorizontal: Spacing.md,
  },
});
