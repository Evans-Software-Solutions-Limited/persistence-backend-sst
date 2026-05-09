/**
 * SessionHeader — flush content-edge header on the active-session screen.
 *
 * Ported 1:1 from `persistence-mobile/components/workouts/ActiveWorkoutScreen`
 * (lines 117-123 + style block 336-360). Workout name on the left,
 * stopwatch icon + live elapsed time on the right. No top-bar chrome,
 * no border, no background — the active-session screen is presented
 * as a modal (Expo Router stack `presentation: "modal"`) so dismissal
 * lives in the modal swipe / hardware back, not a chevron-down button
 * inside the header.
 *
 * Spec: persistence-mobile/components/workouts/ActiveWorkoutScreen
 *       specs/05-active-session/requirements.md STORY-005
 */
import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { styles } from "./styles";
import { Colors } from "@/ui/theme/workoutsLegacyTheme";

export type SessionHeaderProps = {
  /** ISO timestamp the session started. Used to drive the live counter. */
  startedAt: string;
  /** Display name shown on the left. */
  sessionName: string;
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
      <Text style={styles.workoutName} numberOfLines={1}>
        {props.sessionName}
      </Text>
      <View style={styles.timerSection}>
        <Ionicons
          name="stopwatch-outline"
          size={32}
          color={Colors.primary.DEFAULT}
        />
        <Text style={styles.timer} testID="session-header-elapsed">
          {formatDuration(elapsed)}
        </Text>
      </View>
    </View>
  );
}
