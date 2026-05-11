/**
 * Top-semicircle slider with track marks + animated handle + optional
 * label overlay. Drives the WorkoutRatingPresenter's 1-10 difficulty
 * scale.
 *
 * Ported verbatim from
 * `persistence-mobile/components/workouts/SemiCircleSlider/SemiCircleSlider.tsx`
 * — same SVG path math, same epsilon-near-2π trick to keep the
 * spring animation from bouncing at the boundary, same gesture
 * overlay strategy. Imports rewired to V2's theme module.
 */

import { Colors } from "@/ui/theme/workoutsLegacyTheme";
import React, { useCallback, useEffect, useMemo } from "react";
import { Dimensions, StyleSheet, View } from "react-native";
import Animated, {
  useAnimatedProps,
  useDerivedValue,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import Svg, { Circle, Path } from "react-native-svg";

import { arc, polar2Canvas, type Vector } from "./Constants";
import { Cursor } from "./Cursor";
import { SemiCircleSliderGesture } from "./SemiCircleSliderGesture";

interface SemiCircleSliderProps {
  readonly minValue: number;
  readonly maxValue: number;
  readonly value: number;
  readonly onValueChange: (value: number) => void;
  readonly width?: number;
  readonly radius?: number;
  readonly activeColor?: string;
  readonly renderLabel?: (value: number) => React.ReactNode;
}

const DEFAULT_WIDTH = Dimensions.get("window").width - 64;
const DEFAULT_RADIUS = 100;

const AnimatedPath = Animated.createAnimatedComponent(Path);

export function SemiCircleSlider({
  minValue,
  maxValue,
  value,
  onValueChange,
  width = DEFAULT_WIDTH,
  radius = DEFAULT_RADIUS,
  activeColor = Colors.primary.DEFAULT,
  renderLabel,
}: SemiCircleSliderProps) {
  const centerX = width / 2;
  const centerY = radius + 20; // Center is below the semicircle, so semicircle is at top
  const height = radius + 80; // Increased to accommodate label without clipping
  const center: Vector = useMemo(
    () => ({ x: centerX, y: centerY }),
    [centerX, centerY],
  );

  // Convert value to angle in radians
  // Value 1 at 9 o'clock (π), value 10 at 3 o'clock (near 2π)
  // Going clockwise from 9 to 3 along TOP semicircle
  // Use same mapping as track marks: π → 3π/2 → 2π
  // Use 2π - epsilon instead of 0 to avoid wrapping issues with spring animation
  const EPSILON = 0.001; // Small value to avoid exact 0/2π boundary
  const valueToAngle = useCallback(
    (val: number) => {
      const normalized = (val - minValue) / (maxValue - minValue);
      const angle = Math.PI + normalized * Math.PI; // π to 2π
      // Use 2π - epsilon for max value to avoid spring animation bouncing at 0/2π boundary
      return angle >= 2 * Math.PI ? 2 * Math.PI - EPSILON : angle;
    },
    [minValue, maxValue],
  );

  // Convert angle in radians to value
  const angleToValue = useCallback(
    (angleRad: number) => {
      // Normalize angle to [π, 2π) range (matching our valueToAngle function)
      let normalizedAngle = angleRad;
      // Wrap angles less than π (shouldn't happen for top semicircle, but handle gracefully)
      // -----------------------------------------------------------
      // LATENT BUG (bugbot, low severity): for inputs in [0, π/2],
      // these two while loops cancel out — `0 + 2π = 2π` → `2π - 2π
      // = 0` → falls through the `Math.max(π, …)` clamp below and
      // maps to `minValue` instead of the intended `maxValue` (3
      // o'clock semantically = max).
      //
      // Currently unreachable in production: `angleToValue` is only
      // called via `runOnJS(handleAngleChange)` from
      // `SemiCircleSliderGesture`, and `normalizeAngle` there
      // (SemiCircleSliderGesture.tsx:32-68) pre-clamps any 3-o'clock
      // area angle (`normalized === 0 || normalized < π/2`) to
      // `2π - EPSILON` before it reaches here. Bottom-half angles
      // (`[π/2, π)`) return -1 from the gesture helper and are
      // dropped by the caller.
      //
      // Left as-is for 1:1 fidelity with the legacy
      // `persistence-mobile/components/workouts/SemiCircleSlider/SemiCircleSlider.tsx`
      // implementation. If anyone refactors the gesture-side
      // `normalizeAngle` to drop the 3-o'clock-wrap step, this
      // function needs an order-swap (fold into `[0, 2π)` first,
      // then promote `< π` to `2π - ε`) to compensate.
      // -----------------------------------------------------------
      while (normalizedAngle < Math.PI) normalizedAngle += 2 * Math.PI;
      // Wrap angles >= 2π back to near 2π
      while (normalizedAngle >= 2 * Math.PI) normalizedAngle -= 2 * Math.PI;

      // Convert angle to normalized value (0 to 1)
      // Angle goes from π (value 1) to ~2π (value 10)
      // Clamp to [π, 2π] range
      normalizedAngle = Math.max(
        Math.PI,
        Math.min(2 * Math.PI, normalizedAngle),
      );
      const normalized = (normalizedAngle - Math.PI) / Math.PI;

      // Clamp and convert to value
      const clampedNormalized = Math.max(0, Math.min(1, normalized));
      return Math.round(minValue + clampedNormalized * (maxValue - minValue));
    },
    [minValue, maxValue],
  );

  // Shared value for angle in radians
  const angle = useSharedValue(valueToAngle(value));

  // Update angle when value prop changes
  // Use higher damping to reduce bouncing at boundaries
  useEffect(() => {
    const targetAngle = valueToAngle(value);
    angle.value = withSpring(targetAngle, {
      damping: 20,
      stiffness: 150,
      overshootClamping: true, // Prevent overshooting at boundaries
    });
  }, [value, valueToAngle, angle]);

  // Calculate handle position from angle using derived value
  const handlePos = useDerivedValue(() => {
    return polar2Canvas({ theta: angle.value, radius }, center);
  });

  // Animated props for active path
  const activePathProps = useAnimatedProps(() => {
    const handlePoint = handlePos.value;
    const startPoint = polar2Canvas({ theta: Math.PI, radius }, center); // Start from left (9 o'clock, value 1)
    // Use same sweep direction as background arc: sweep=true (clockwise)
    return {
      d: `M ${startPoint.x} ${startPoint.y} ${arc(handlePoint.x, handlePoint.y, false, true)}`,
    };
  });

  // Handle angle change from gesture
  const handleAngleChange = useCallback(
    (newAngle: number) => {
      const newValue = angleToValue(newAngle);
      if (newValue !== value) {
        onValueChange(newValue);
      }
    },
    [angleToValue, value, onValueChange],
  );

  // Create semicircle background path (left to right: π to 2π, clockwise along top)
  // From 9 o'clock (π) to 3 o'clock (~2π) going clockwise: π → 3π/2 (top) → 2π
  // This requires sweep=1 (clockwise) in SVG
  const EPSILON_PATH = 0.001;
  const startPoint = polar2Canvas({ theta: Math.PI, radius }, center); // Left (9 o'clock, value 1)
  const endPoint = polar2Canvas(
    { theta: 2 * Math.PI - EPSILON_PATH, radius },
    center,
  ); // Right (3 o'clock, value 10)
  const semicirclePath = `M ${startPoint.x} ${startPoint.y} ${arc(endPoint.x, endPoint.y, false, true)}`;

  // Calculate track mark positions
  // The background arc goes from π to 0 with sweep=true (clockwise through top)
  // For track marks, we need to calculate positions along that same path
  // Path: π (9 o'clock) → 3π/2 (12 o'clock/top) → 2π/0 (3 o'clock)
  const trackMarks = useMemo(() => {
    return Array.from({ length: maxValue - minValue + 1 }, (_, i) => {
      const markValue = minValue + i;
      const normalized = (markValue - minValue) / (maxValue - minValue);

      // Interpolate angle from π to 2π along the top semicircle
      // Since we want to go through 3π/2 (top), we interpolate: π → 3π/2 → 2π
      const angle = Math.PI + normalized * Math.PI; // π to 2π
      // Use 2π - epsilon for the last mark (value 10) to match valueToAngle
      const normalizedAngle =
        angle >= 2 * Math.PI ? 2 * Math.PI - EPSILON : angle;

      const point = polar2Canvas({ theta: normalizedAngle, radius }, center);
      return {
        value: markValue,
        point,
      };
    });
  }, [minValue, maxValue, radius, center]);

  return (
    <View style={[styles.container, { width, height }]}>
      {/* SVG rendered first (behind) but visible */}
      <Svg
        width={width}
        height={height}
        style={styles.svg}
        pointerEvents="none"
      >
        {/* Background semicircle */}
        <Path
          d={semicirclePath}
          stroke={Colors.surface.border}
          strokeWidth={6}
          fill="none"
          strokeLinecap="round"
        />
        {/* Active semicircle - animated path showing progress */}
        <AnimatedPath
          stroke={activeColor}
          strokeWidth={6}
          fill="none"
          strokeLinecap="round"
          animatedProps={activePathProps}
        />
        {/* Track marks */}
        {trackMarks.map(({ value: markValue, point }) => (
          <Circle
            key={markValue}
            cx={point.x}
            cy={point.y}
            r={8}
            fill={markValue <= value ? activeColor : Colors.surface.border}
          />
        ))}
        {/* Slider handle - animated cursor */}
        <Cursor pos={handlePos} color={activeColor} radius={14} />
      </Svg>
      {/* Gesture handler overlay - rendered last (on top) to capture touches */}
      <View style={styles.gestureContainer}>
        <SemiCircleSliderGesture
          angle={angle}
          handlePos={handlePos}
          center={center}
          radius={radius}
          onAngleChange={handleAngleChange}
        />
      </View>
      {/* Optional label - rendered on top of everything */}
      {renderLabel && (
        <View
          style={[
            styles.labelContainer,
            {
              // Position label to sit on the base of the semicircle
              // centerY (120) is the bottom edge/base of the semicircle
              // Position it higher so it sits nicely on the base within the semicircle area
              top: centerY - 40, // 40px above the base (centerY) for better positioning
              // Ensure container is tall enough to fit large text without clipping
              minHeight: 70,
              justifyContent: "center",
            },
          ]}
          pointerEvents="none"
        >
          {renderLabel(value)}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    overflow: "visible",
    zIndex: 0, // Lower z-index so parent can place elements on top
  },
  svg: {
    position: "absolute",
    top: 0,
    left: 0,
  },
  gestureContainer: {
    ...StyleSheet.absoluteFillObject,
  },
  labelContainer: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    justifyContent: "center",
    // Ensure text isn't clipped
    overflow: "visible",
    paddingVertical: 8, // Extra padding to prevent clipping
  },
});
