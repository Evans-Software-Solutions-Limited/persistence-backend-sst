/**
 * SessionHeader — active-session header.
 *
 * 05.3 re-skin to the prototype (`active-workout.jsx:16–42`): a chevron-down
 * minimise button (left), a centred workout name with a live mono elapsed
 * timer beneath it, and an "End" pill (right). Elapsed time is wall-clock
 * derived from `startedAt` (survives backgrounding) — the 1s interval only
 * drives re-render.
 *
 * The minimise button collapses the session to the floating
 * `<ActiveWorkoutBar>` (STORY-002 AC 2.4); the End pill opens the end-confirm
 * flow (STORY-002 AC 2.5 → STORY-005).
 *
 * Spec: specs/05-active-session/requirements.md STORY-002
 *       ~/Downloads/handoff/design-source/screens/active-workout.jsx:16–42
 */
import React, { useEffect, useState } from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { styles } from "./styles";
import { IconChevronD, IconTimer } from "@/ui/components/icons";
import { color } from "@/ui/theme/tokens";

export type SessionHeaderProps = {
  /** ISO timestamp the session started. Used to drive the live counter. */
  startedAt: string;
  /** Display name shown centred. */
  sessionName: string;
  /** Collapse the session to the floating bar. */
  onMinimize: () => void;
  /** Open the end-confirm flow. */
  onEnd: () => void;
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
        onPress={props.onMinimize}
        style={styles.minimizeButton}
        testID="session-minimize"
        accessibilityLabel="Minimise workout"
      >
        <IconChevronD size={16} color={color.$text2} />
      </TouchableOpacity>

      <View style={styles.centerSection}>
        <Text style={styles.workoutName} numberOfLines={1}>
          {props.sessionName}
        </Text>
        <View style={styles.timerSection}>
          <IconTimer size={11} color={color.$primary} />
          <Text style={styles.timer} testID="session-header-elapsed">
            {formatDuration(elapsed)}
          </Text>
        </View>
      </View>

      <TouchableOpacity
        onPress={props.onEnd}
        style={styles.endButton}
        testID="session-end"
        accessibilityLabel="End workout"
      >
        <Text style={styles.endButtonText}>End</Text>
      </TouchableOpacity>
    </View>
  );
}
