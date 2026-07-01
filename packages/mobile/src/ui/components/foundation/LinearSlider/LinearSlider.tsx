/**
 * <LinearSlider> — gesture-driven horizontal slider primitive.
 *
 * Built for the Fuel Targets TDEE calculator (M9 — goal cut↔bulk slider +
 * the 3 macro-split sliders; `fuel-targets.jsx`), which has no linear-slider
 * equivalent in the app (the only existing slider, `SemiCircleSlider`, is
 * polar/circular for the workout-rating dial). Deliberately generic so both
 * callers reuse one gesture implementation:
 *  - the goal slider supplies `trackBackground` (its own gradient + tick
 *    marks) and omits `fillColor` — the track is a static multi-colour strip,
 *    only the thumb moves;
 *  - the macro sliders supply `fillColor` and no custom background — a
 *    single-colour track with a proportional fill bar.
 *
 * Gesture pattern (Pan + Tap race, worklet → runOnJS bridge) mirrors
 * `SemiCircleSliderGesture`; the linear position math lives in `math.ts`
 * (unit-tested) rather than inline in the worklet, keeping the interaction
 * logic testable without mounting react-native-gesture-handler.
 *
 * `react-native-gesture-handler` is globally mocked as a no-op passthrough in
 * `__tests__/setup.ts` (see the `SemiCircleSlider` precedent) — gesture
 * behaviour is pixel-driven and isn't asserted in Jest; this file is excluded
 * from the coverage threshold in `package.json` for the same reason.
 */

import { useCallback, useState, type ReactNode } from "react";
import { StyleSheet, View as RNView } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS } from "react-native-reanimated";

import { clampFraction, fractionToValue, valueToFraction } from "./math";

export type LinearSliderProps = {
  min: number;
  max: number;
  /** Quantisation step. Default 1. Pass 0 for continuous (no rounding). */
  step?: number;
  value: number;
  onValueChange: (value: number) => void;
  disabled?: boolean;
  /** Gesture/track area height. Default 24. */
  height?: number;
  /** Visual track bar thickness (centred within `height`). Default 4. */
  trackHeight?: number;
  /** Track colour behind the fill (or the whole track when no fill/background). */
  trackColor?: string;
  /**
   * Proportional fill colour from the track's start to the thumb. Omit for a
   * static track (e.g. the goal slider's gradient, supplied via
   * `trackBackground`) where only the thumb should move.
   */
  fillColor?: string;
  /**
   * Custom background content (gradient, tick marks, …), absolutely filled
   * behind the fill bar and thumb. `pointerEvents="none"` — the gesture
   * overlay above it owns all touch handling.
   */
  trackBackground?: ReactNode;
  thumbSize?: number;
  thumbBorderColor: string;
  thumbBorderWidth?: number;
  thumbColor?: string;
  /** Adds a coloured glow shadow around the thumb (the goal slider only). */
  glow?: boolean;
  testID?: string;
  accessibilityLabel?: string;
};

export function LinearSlider({
  min,
  max,
  step = 1,
  value,
  onValueChange,
  disabled = false,
  height = 24,
  trackHeight = 4,
  trackColor = "#23252F",
  fillColor,
  trackBackground,
  thumbSize = 20,
  thumbBorderColor,
  thumbBorderWidth = 3,
  thumbColor = "#F4F4F6",
  glow = false,
  testID,
  accessibilityLabel,
}: LinearSliderProps) {
  const [trackWidth, setTrackWidth] = useState(0);

  const onLayout = useCallback(
    (e: { nativeEvent: { layout: { width: number } } }) => {
      setTrackWidth(e.nativeEvent.layout.width);
    },
    [],
  );

  const handleFractionChange = useCallback(
    (fraction: number) => {
      const next = fractionToValue(fraction, min, max, step);
      if (next !== value) onValueChange(next);
    },
    [min, max, step, value, onValueChange],
  );

  // Worklets close over `trackWidth`/`disabled`/`handleFractionChange` by
  // value at creation; all are plain JS values (numbers, a boolean, a
  // stable-ish callback), so recreating the gesture on change (React
  // re-renders the JSX below with fresh `Gesture.Pan()` instances every
  // render) keeps them current — there's no persistent gesture identity to
  // go stale. The `disabled` check lives IN the worklet (not `.enabled()`)
  // because the react-native-gesture-handler test double (`__tests__/setup.ts`)
  // doesn't implement chained builder methods beyond `on*`.
  type GestureX = { x: number };
  const panGesture = Gesture.Pan().onUpdate((e: GestureX) => {
    "worklet";
    if (disabled) return;
    const fraction = clampFraction(e.x, trackWidth);
    runOnJS(handleFractionChange)(fraction);
  });

  const tapGesture = Gesture.Tap()
    .maxDuration(250)
    .onEnd((e: GestureX) => {
      "worklet";
      if (disabled) return;
      const fraction = clampFraction(e.x, trackWidth);
      runOnJS(handleFractionChange)(fraction);
    });

  const composedGesture = Gesture.Race(tapGesture, panGesture);

  const fraction = valueToFraction(value, min, max);
  const thumbLeft =
    trackWidth > 0
      ? Math.max(
          0,
          Math.min(
            trackWidth - thumbSize,
            fraction * trackWidth - thumbSize / 2,
          ),
        )
      : 0;

  return (
    <RNView
      testID={testID}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="adjustable"
      accessibilityValue={{ min, max, now: value }}
      accessibilityState={{ disabled }}
      onLayout={onLayout}
      style={[styles.container, { height, opacity: disabled ? 0.85 : 1 }]}
    >
      {trackBackground ?? (
        <RNView
          pointerEvents="none"
          style={[
            styles.track,
            {
              height: trackHeight,
              backgroundColor: trackColor,
              borderRadius: trackHeight / 2,
            },
          ]}
        />
      )}
      {fillColor !== undefined && trackWidth > 0 && (
        <RNView
          pointerEvents="none"
          style={[
            styles.track,
            {
              height: trackHeight,
              width: fraction * trackWidth,
              backgroundColor: fillColor,
              borderRadius: trackHeight / 2,
            },
          ]}
        />
      )}
      <RNView
        pointerEvents="none"
        style={{
          position: "absolute",
          left: thumbLeft,
          width: thumbSize,
          height: thumbSize,
          borderRadius: thumbSize / 2,
          backgroundColor: thumbColor,
          borderWidth: thumbBorderWidth,
          borderColor: thumbBorderColor,
          ...(glow
            ? {
                shadowColor: thumbBorderColor,
                shadowOpacity: 1,
                shadowRadius: 8,
                shadowOffset: { width: 0, height: 0 },
                elevation: 6,
              }
            : null),
        }}
      />
      <GestureDetector gesture={composedGesture}>
        <Animated.View style={StyleSheet.absoluteFill} />
      </GestureDetector>
    </RNView>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: "center",
    position: "relative",
  },
  track: {
    position: "absolute",
    left: 0,
  },
});
