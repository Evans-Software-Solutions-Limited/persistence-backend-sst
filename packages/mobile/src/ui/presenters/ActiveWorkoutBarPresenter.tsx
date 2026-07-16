import { Text, View } from "@tamagui/core";
import { Pressable } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { useEffect } from "react";
import { useReducedMotionGate } from "@/ui/hooks/useReducedMotionGate";
import { IconChevronUp, IconTimer } from "@/ui/components/icons";

/**
 * <ActiveWorkoutBarPresenter> — the minimised "workout in progress" bar.
 *
 * Pure presenter. Ports `~/Downloads/handoff/design-source/screens/
 * active-workout.jsx:142–181`: a floating cyan-glow pill with a pulsing
 * primary dot, "WORKOUT IN PROGRESS" eyebrow, truncated workout name, mono
 * timer, and an up-chevron affordance. Tap expands (re-opens the session
 * modal); long-press is the end escape hatch (STORY-006 AC 6.7).
 *
 * Positioning is owned by `<ActiveWorkoutOverlay>` (the absolute wrapper +
 * `tabBarHeight` math) — this presenter renders only the pill so it stays
 * unit-testable without navigation/inset context.
 *
 * Spec: specs/05-active-session/design.md § <ActiveWorkoutBarPresenter>
 *       specs/05-active-session/requirements.md STORY-006 (AC 6.3)
 */

export type ActiveWorkoutBarPresenterProps = {
  workoutName: string;
  /** Wall-clock elapsed seconds (derived from session.startedAt upstream). */
  elapsedSeconds: number;
  onPress: () => void;
  /** End escape hatch — long-press. */
  onLongPress?: () => void;
  /** Test seam — force reduced-motion (skips the pulse animation). */
  reduceMotionOverride?: boolean;
  testID?: string;
};

/** m:ss — matches the prototype's `fmt` (no hour segment). */
export function formatBarElapsed(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function ActiveWorkoutBarPresenter({
  workoutName,
  elapsedSeconds,
  onPress,
  onLongPress,
  reduceMotionOverride,
  testID = "active-workout-bar",
}: ActiveWorkoutBarPresenterProps) {
  const gate = useReducedMotionGate();
  // Consume the shared gate's `pulseDots` in production; the test seam still
  // forces the pulse on/off deterministically (`?? undefined` → gate value).
  const shouldPulse =
    reduceMotionOverride != null ? !reduceMotionOverride : gate.pulseDots;

  // Pulse the dot opacity 1 → 0.35 and back, 1.4s cycle (700ms each leg),
  // matching `active-workout.jsx:166` `awbarpulse 1.4s ease-in-out infinite`.
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (!shouldPulse) {
      pulse.value = 1;
      return;
    }
    pulse.value = withRepeat(withTiming(0.35, { duration: 700 }), -1, true);
  }, [shouldPulse, pulse]);
  const dotStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={400}
      accessibilityRole="button"
      accessibilityLabel={`Workout in progress: ${workoutName}. Tap to resume, long-press to end.`}
      testID={testID}
    >
      <View
        flexDirection="row"
        alignItems="center"
        gap={10}
        paddingVertical={10}
        paddingHorizontal={14}
        borderRadius={14}
        backgroundColor="$surface2"
        borderWidth={1}
        borderColor="$primaryDim"
        // Cyan glow — the prototype's `0 12px 32px` y-offset is a downward web
        // drop-shadow; on a pill floating directly above the tab bar that
        // pushes the halo ~32px DOWN onto the tab bar (Brad: "glow goes too
        // close to the drawer"). Use a symmetric halo (offset 0) with a tighter
        // radius so the glow hugs the pill and doesn't bleed into the nav.
        shadowColor="$primary"
        shadowOffset={{ width: 0, height: 0 }}
        shadowOpacity={0.45}
        shadowRadius={14}
      >
        {/* Pulsing dot */}
        <Animated.View style={dotStyle} testID="active-workout-bar-pulse">
          <View
            width={8}
            height={8}
            borderRadius={4}
            backgroundColor="$primary"
            shadowColor="$primary"
            shadowOpacity={0.9}
            shadowRadius={4}
          />
        </Animated.View>

        <View flex={1} minWidth={0}>
          <Text
            color="$primary"
            fontSize={9}
            fontWeight="700"
            letterSpacing={0.9}
            marginBottom={1}
          >
            WORKOUT IN PROGRESS
          </Text>
          <Text
            color="$text"
            fontSize={13}
            fontWeight="600"
            numberOfLines={1}
            ellipsizeMode="tail"
            testID="active-workout-bar-title"
          >
            {workoutName}
          </Text>
        </View>

        <View flexDirection="row" alignItems="center" gap={4}>
          <IconTimer size={12} color="#22D3EE" />
          <Text
            color="$primary"
            fontSize={14}
            fontWeight="600"
            fontFamily="$mono"
            fontVariant={["tabular-nums"]}
            testID="active-workout-bar-timer"
          >
            {formatBarElapsed(elapsedSeconds)}
          </Text>
        </View>

        <IconChevronUp size={14} color="#22D3EE" />
      </View>
    </Pressable>
  );
}
