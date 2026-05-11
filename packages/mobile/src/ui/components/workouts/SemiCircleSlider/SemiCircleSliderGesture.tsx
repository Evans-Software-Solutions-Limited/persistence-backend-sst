/**
 * Gesture overlay for the SemiCircleSlider — converts pan + tap
 * coordinates into a polar angle on the top semicircle, writes it
 * into the slider's `angle` shared value, and bridges to JS via
 * `runOnJS(onAngleChange)`.
 *
 * Ported verbatim from
 * `persistence-mobile/components/workouts/SemiCircleSlider/SemiCircleSliderGesture.tsx`.
 *
 * The `normalizeAngle` helper is the subtle bit — it clamps to the
 * top half (`y < center.y`) and rewraps angles near 0/2π so the
 * spring animation doesn't bounce when the value sits at the
 * 3-o'clock boundary. Both behaviours are preserved 1:1.
 */

import React from "react";
import { StyleSheet } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, type SharedValue } from "react-native-reanimated";
import { canvas2Polar, containedInSquare, type Vector } from "./Constants";

interface SemiCircleSliderGestureProps {
  readonly angle: SharedValue<number>;
  readonly handlePos: SharedValue<Vector>;
  readonly center: Vector;
  readonly radius: number;
  readonly onAngleChange: (angle: number) => void;
}

// Normalize angle to match track mark angle system (π to 2π range)
const EPSILON = 0.001; // Small value to avoid exact 0/2π boundary
const normalizeAngle = (
  angle: number,
  center: Vector,
  touchPoint: Vector,
): number => {
  "worklet";
  // For top semicircle: angles go from π (9 o'clock) to 2π - epsilon (3 o'clock) through 3π/2 (top)
  // We want to restrict to the top half (y < center.y)

  // Check if touch is in the top half (y < center.y means above center)
  const isTopHalf = touchPoint.y < center.y;

  if (!isTopHalf) {
    // If touch is in bottom half, don't update
    return -1; // Invalid angle, will be ignored
  }

  // Normalize angle to [0, 2π) range
  let normalized = angle;
  while (normalized < 0) normalized += 2 * Math.PI;
  while (normalized >= 2 * Math.PI) normalized -= 2 * Math.PI;

  // For top semicircle, valid angles are in [π, 2π)
  // Use 2π - epsilon instead of 0 for consistency with valueToAngle
  if (normalized >= Math.PI && normalized < 2 * Math.PI) {
    // Angle is in [π, 2π) range - perfect for top semicircle
    // If angle is very close to 0 (from wrapping), use 2π - epsilon instead
    return normalized;
  } else if (normalized === 0 || (normalized > 0 && normalized < Math.PI / 2)) {
    // Angle is 0 or very close to 0 (3 o'clock area)
    // Use 2π - epsilon to match valueToAngle behavior and avoid spring bouncing
    return 2 * Math.PI - EPSILON;
  } else {
    // Angle is in [π/2, π) range - this is the bottom half, shouldn't happen due to isTopHalf check
    return -1;
  }
};

export function SemiCircleSliderGesture({
  angle,
  handlePos,
  center,
  radius,
  onAngleChange,
}: SemiCircleSliderGestureProps) {
  const handleAngleChange = React.useCallback(
    (newAngle: number) => {
      onAngleChange(newAngle);
    },
    [onAngleChange],
  );

  // Pan + Tap callback events are read for `x` / `y` only. Annotate
  // inline to satisfy noImplicitAny — the gesture-handler chain
  // returns a builder type whose generic signatures don't always
  // narrow back to the typed event payload through `.onStart` →
  // `.onUpdate` (and similar for Tap → `.maxDuration` → `.onEnd`).
  type GestureXY = { x: number; y: number };

  const panGesture = Gesture.Pan()
    .onStart((e: GestureXY) => {
      "worklet";
      const touchPoint: Vector = { x: e.x, y: e.y };
      const dx = touchPoint.x - center.x;
      const dy = touchPoint.y - center.y;
      const distance = Math.hypot(dx, dy);

      // Check if touch is near the handle or the semicircle
      if (containedInSquare(touchPoint, handlePos.value, 44)) {
        // Touch on handle - start dragging
        return;
      }

      // Check if touch is near the semicircle path
      if (distance >= radius - 60 && distance <= radius + 60) {
        const touchAngle = canvas2Polar(touchPoint, center);
        const normalizedAngle = normalizeAngle(touchAngle, center, touchPoint);
        if (normalizedAngle >= 0) {
          angle.value = normalizedAngle;
          runOnJS(handleAngleChange)(normalizedAngle);
        }
      }
    })
    .onUpdate((e: GestureXY) => {
      "worklet";
      const touchPoint: Vector = { x: e.x, y: e.y };
      const touchAngle = canvas2Polar(touchPoint, center);
      const normalizedAngle = normalizeAngle(touchAngle, center, touchPoint);
      if (normalizedAngle >= 0) {
        angle.value = normalizedAngle;
        runOnJS(handleAngleChange)(normalizedAngle);
      }
    });

  const tapGesture = Gesture.Tap()
    .maxDuration(250)
    .onEnd((e: GestureXY) => {
      "worklet";
      const touchPoint: Vector = { x: e.x, y: e.y };
      const dx = touchPoint.x - center.x;
      const dy = touchPoint.y - center.y;
      const distance = Math.hypot(dx, dy);

      if (distance >= radius - 60 && distance <= radius + 60) {
        const touchAngle = canvas2Polar(touchPoint, center);
        const normalizedAngle = normalizeAngle(touchAngle, center, touchPoint);
        if (normalizedAngle >= 0) {
          angle.value = normalizedAngle;
          runOnJS(handleAngleChange)(normalizedAngle);
        }
      }
    });

  const composedGesture = Gesture.Race(tapGesture, panGesture);

  return (
    <GestureDetector gesture={composedGesture}>
      <Animated.View style={StyleSheet.absoluteFill} />
    </GestureDetector>
  );
}
