import { useEffect } from "react";
import { View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

/**
 * <Bar> — linear progress bar with an animated fill.
 * Ports ~/Downloads/handoff/design-source/ui.jsx:239-250.
 * Implements 01-design-system/design.md § Foundation primitives #6 +
 * STORY-003 AC 3.5 (Reanimated 3 + useReducedMotion).
 *
 * Width animates via `withTiming` (600ms, cubic-bezier 0.2,0.7,0.2,1). When
 * the OS "reduce motion" setting is on, the fill jumps to its final width.
 *
 * Note: the fill/track take concrete colour strings (not Tamagui tokens)
 * because the animated fill renders through an Animated.View which doesn't
 * resolve the token theme. Defaults are the resolved $primary / $surface3.
 */

export type BarProps = {
  /** 0..1. Clamped. */
  pct: number;
  /** Fill colour. Default resolved $primary (#22D3EE). */
  color?: string;
  /** Bar height. Default 6. */
  height?: number;
  /** Track colour. Default resolved $surface3 (#232735). */
  track?: string;
  /** Adds a coloured glow shadow on the fill. */
  glow?: boolean;
  testID?: string;
  accessibilityLabel?: string;
};

const FILL_DEFAULT = "#22D3EE"; // $primary
const TRACK_DEFAULT = "#232735"; // $surface3
const DURATION_MS = 600;

export function Bar({
  pct,
  color = FILL_DEFAULT,
  height = 6,
  track = TRACK_DEFAULT,
  glow = false,
  testID,
  accessibilityLabel,
}: BarProps) {
  const clamped = Math.min(1, Math.max(0, pct));
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(reduceMotion ? clamped : 0);

  useEffect(() => {
    if (reduceMotion) {
      progress.value = clamped;
      return;
    }
    progress.value = withTiming(clamped, {
      duration: DURATION_MS,
      easing: Easing.bezier(0.2, 0.7, 0.2, 1),
    });
  }, [clamped, reduceMotion, progress]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${progress.value * 100}%`,
  }));

  return (
    <View
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ now: Math.round(clamped * 100), min: 0, max: 100 }}
      style={{
        width: "100%",
        height,
        backgroundColor: track,
        borderRadius: height,
        overflow: "hidden",
      }}
    >
      <Animated.View
        testID={testID ? `${testID}-fill` : undefined}
        style={[
          {
            height: "100%",
            backgroundColor: color,
            borderRadius: height,
          },
          glow
            ? {
                shadowColor: color,
                shadowOpacity: 0.8,
                shadowRadius: 8,
                shadowOffset: { width: 0, height: 0 },
                elevation: 4,
              }
            : null,
          fillStyle,
        ]}
      />
    </View>
  );
}
