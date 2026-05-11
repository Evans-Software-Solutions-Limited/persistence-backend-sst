/**
 * Animated SVG circle that follows the slider handle position.
 *
 * Ported verbatim from
 * `persistence-mobile/components/workouts/SemiCircleSlider/Cursor.tsx`
 * — `useAnimatedProps` reads the shared `pos` value each frame and
 * writes `cx` / `cy` / `r` onto the underlying `<Circle>` via
 * reanimated's animated-component wrapper.
 */

import { Colors } from "@/ui/theme/workoutsLegacyTheme";
import React from "react";
import Animated, {
  type SharedValue,
  useAnimatedProps,
} from "react-native-reanimated";
import { Circle } from "react-native-svg";

import { type Vector } from "./Constants";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface CursorProps {
  readonly pos: SharedValue<Vector>;
  readonly color: string;
  readonly radius?: number;
  readonly strokeColor?: string;
  readonly strokeWidth?: number;
}

export function Cursor({
  pos,
  color,
  radius = 14,
  strokeColor = Colors.background.primary,
  strokeWidth = 4,
}: CursorProps) {
  const animatedProps = useAnimatedProps(() => {
    const { x, y } = pos.value;
    return {
      cx: x,
      cy: y,
      r: radius,
    };
  });
  return (
    <AnimatedCircle
      animatedProps={animatedProps}
      fill={color}
      stroke={strokeColor}
      strokeWidth={strokeWidth}
    />
  );
}
