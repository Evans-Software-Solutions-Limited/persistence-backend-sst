/**
 * SessionHeader — top of the active-session screen. Live session
 * duration, exercise progress (e.g. 3/6), close action.
 *
 * Spec: specs/05-active-session/requirements.md STORY-005
 */

import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { styles } from "./styles";
import { Colors } from "@/ui/theme/workoutsLegacyTheme";

export type SessionHeaderProps = {
  /** ISO timestamp the session started. Used to drive the live counter. */
  startedAt: string;
  /** Display name. */
  sessionName: string;
  /** Current exercise position (1-based) and total non-substituted exercises. */
  exerciseIndex: number;
  totalExercises: number;
  onClose: () => void;
  /** Override clock for tests. */
  clock?: () => number;
};

const formatDuration = (seconds: number): string => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
};

export function SessionHeader(props: SessionHeaderProps) {
  const clock = props.clock ?? (() => Date.now());
  const startedAtMs = Date.parse(props.startedAt);
  const computeElapsed = () =>
    Number.isFinite(startedAtMs)
      ? Math.max(0, Math.floor((clock() - startedAtMs) / 1000))
      : 0;

  const [elapsed, setElapsed] = useState(computeElapsed);

  useEffect(() => {
    const id = setInterval(() => setElapsed(computeElapsed()), 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.startedAt]);

  return (
    <View style={styles.container} testID="session-header">
      <TouchableOpacity
        onPress={props.onClose}
        style={styles.closeButton}
        accessibilityLabel="Close session"
        testID="session-header-close"
      >
        <Ionicons name="chevron-down" size={24} color={Colors.text.primary} />
      </TouchableOpacity>
      <View style={styles.center}>
        <Text style={styles.name} numberOfLines={1}>
          {props.sessionName}
        </Text>
        <Text style={styles.subtitle}>
          {formatDuration(elapsed)} · Exercise {props.exerciseIndex} of{" "}
          {props.totalExercises}
        </Text>
      </View>
      <View style={styles.spacer} />
    </View>
  );
}
