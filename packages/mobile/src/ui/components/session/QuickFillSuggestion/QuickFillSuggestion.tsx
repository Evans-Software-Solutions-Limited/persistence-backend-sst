/**
 * QuickFillSuggestion — "Last time: 80kg × 8" hint shown above an
 * empty SetLogger row. Tap to fill (M3, Story-002).
 *
 * Source priority codified per EXECUTION_PLAN § 3.5: in-session
 * previous set → personalRecords cache → nothing.
 */

import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Text, TouchableOpacity } from "react-native";
import { styles } from "./styles";
import { Colors } from "@/ui/theme/workoutsLegacyTheme";

export type QuickFillSuggestionProps = {
  /** kg, can validly be 0 (bodyweight). M2 learning #8: falsy-zero safe. */
  weightKg: number | null;
  /** Same falsy-zero caveat. */
  reps: number | null;
  onFill: () => void;
};

export function QuickFillSuggestion(props: QuickFillSuggestionProps) {
  if (props.weightKg == null || props.reps == null) return null;

  return (
    <TouchableOpacity
      style={styles.row}
      onPress={props.onFill}
      testID="quickfill-suggestion"
      accessibilityLabel={`Fill from last set: ${props.weightKg} kilograms times ${props.reps} reps`}
    >
      <Ionicons name="time-outline" size={14} color={Colors.text.secondary} />
      <Text style={styles.text}>
        Last time: {formatNumber(props.weightKg)}kg × {props.reps}
      </Text>
    </TouchableOpacity>
  );
}

function formatNumber(n: number): string {
  return Number.isInteger(n) ? n.toString() : n.toFixed(1);
}
