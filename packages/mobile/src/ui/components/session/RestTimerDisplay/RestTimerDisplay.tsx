/**
 * Rest timer overlay — countdown ring + Skip / +30s / +60s controls
 * (M3, Story-003).
 *
 * Pure presenter — receives state + callbacks from `useRestTimer`.
 * Renders only when `isActive` per FRONTEND_BRIEF § Group C.
 *
 * Spec: specs/05-active-session/requirements.md STORY-003
 */

import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Text, TouchableOpacity, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { styles } from "./styles";
import { Colors } from "@/ui/theme/workoutsLegacyTheme";

const SIZE = 160;
const STROKE = 10;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export type RestTimerDisplayProps = {
  isActive: boolean;
  remainingSeconds: number;
  totalSeconds: number;
  /** 0..1 elapsed-fraction — drives the ring stroke offset. */
  progress: number;
  onSkip: () => void;
  onExtend: (seconds: number) => void;
  onDismiss: () => void;
};

const formatTime = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
};

export function RestTimerDisplay(props: RestTimerDisplayProps) {
  if (!props.isActive) return null;

  // Falsy-zero safe — remainingSeconds CAN be 0 (timer just hit zero
  // before the parent unmounted). M2 learning #8.
  const seconds = props.remainingSeconds != null ? props.remainingSeconds : 0;
  const offset = CIRCUMFERENCE * (1 - props.progress);

  return (
    <View style={styles.container} testID="rest-timer-display">
      <View style={styles.ringWrap}>
        <Svg width={SIZE} height={SIZE}>
          <Circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            stroke={Colors.surface.tertiary}
            strokeWidth={STROKE}
            fill="none"
          />
          <Circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            stroke={Colors.primary.DEFAULT}
            strokeWidth={STROKE}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={`${CIRCUMFERENCE} ${CIRCUMFERENCE}`}
            strokeDashoffset={offset}
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          />
        </Svg>
        <View style={styles.ringLabel}>
          <Text style={styles.timeText}>{formatTime(seconds)}</Text>
          <Text style={styles.captionText}>Rest</Text>
        </View>
      </View>

      <View style={styles.controls}>
        <TouchableOpacity
          style={styles.controlButton}
          onPress={() => props.onExtend(30)}
          testID="rest-timer-extend-30"
          accessibilityLabel="Add 30 seconds"
        >
          <Text style={styles.controlText}>+30s</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.controlButton, styles.controlButtonPrimary]}
          onPress={props.onSkip}
          testID="rest-timer-skip"
          accessibilityLabel="Skip rest"
        >
          <Ionicons
            name="play-skip-forward"
            size={20}
            color={Colors.text.primary}
          />
          <Text style={styles.controlTextPrimary}>Skip</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.controlButton}
          onPress={() => props.onExtend(60)}
          testID="rest-timer-extend-60"
          accessibilityLabel="Add 60 seconds"
        >
          <Text style={styles.controlText}>+60s</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
