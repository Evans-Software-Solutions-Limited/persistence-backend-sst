/**
 * Rest timer overlay — full-screen takeover ported 1:1 from
 * `persistence-mobile/components/workouts/RestTimerScreen/RestTimerScreen.tsx`.
 *
 * Renders only when `isActive` per FRONTEND_BRIEF § Group C. When
 * mounted, it covers the active-session screen entirely (legacy uses
 * `currentView === 'timer'` to swap views inside ActiveWorkoutModal;
 * V2 uses absolute positioning to achieve the same visual effect on
 * top of the rest of the session screen).
 *
 * Layout: timer-outline icon (size 64), MM:SS time text (72 px),
 * "REST TIME" caption, single "Stop Timer" button. NO +30s / +60s
 * controls — legacy has none and the V2 redesign that added them is
 * removed.
 *
 * Spec: persistence-mobile/components/workouts/RestTimerScreen/RestTimerScreen.tsx
 *       specs/05-active-session/requirements.md STORY-003
 */

import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { styles } from "./styles";
import { color } from "@/ui/theme/tokens";

export type RestTimerDisplayProps = {
  isActive: boolean;
  remainingSeconds: number;
  totalSeconds: number;
  /** 0..1 elapsed-fraction. Currently unused by the legacy-1:1 port but
   * retained on the prop type so the container's wiring stays stable
   * while the UI is in transition. */
  progress: number;
  /** "Stop Timer" — clears the timer state and returns the user to the
   * underlying active-session screen. Legacy `RestTimerScreen.onStop`. */
  onSkip: () => void;
  /** Called when remainingSeconds hits zero. Container clears the
   * timer state on receipt. */
  onDismiss: () => void;
};

const formatTime = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
};

export function RestTimerDisplay(props: RestTimerDisplayProps) {
  if (!props.isActive) return null;

  return (
    <View style={styles.container} testID="rest-timer-display">
      <View style={styles.content}>
        <View style={styles.timerContainer}>
          <Ionicons name="timer-outline" size={64} color={color.$primary} />
          <Text style={styles.timerText}>
            {formatTime(props.remainingSeconds)}
          </Text>
          <Text style={styles.timerLabel}>Rest Time</Text>
        </View>

        <View style={styles.buttonContainer}>
          <TouchableOpacity
            onPress={props.onSkip}
            style={styles.stopButton}
            testID="rest-timer-skip"
            accessibilityLabel="Stop rest timer"
          >
            <Text style={styles.stopButtonText}>Stop Timer</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}
