/**
 * Polar / canvas math + SVG-arc string builder for the SemiCircleSlider.
 *
 * Ported verbatim from
 * `persistence-mobile/components/workouts/SemiCircleSlider/Constants.ts`
 * — V2 keeps the same `R = 100` semicircle radius constant so the
 * StyleSheet sizing and arc geometry render pixel-identically to the
 * legacy reference.
 *
 * All exports carry the `'worklet'` directive so they're callable from
 * the reanimated UI thread (the gesture handler walks them inside
 * `Gesture.Pan().onUpdate` workletised closures).
 */

const R = 100; // Radius for semicircle

export interface Vector {
  x: number;
  y: number;
}

// Convert polar coordinates to canvas coordinates
export const polar2Canvas = (
  { theta, radius }: { theta: number; radius: number },
  center: Vector,
): Vector => {
  "worklet";
  return {
    x: center.x + radius * Math.cos(theta),
    y: center.y + radius * Math.sin(theta),
  };
};

// Convert canvas coordinates to polar angle
export const canvas2Polar = (point: Vector, center: Vector): number => {
  "worklet";
  return Math.atan2(point.y - center.y, point.x - center.x);
};

// Check if point is contained in a square around a position
export const containedInSquare = (
  value: Vector,
  center: Vector,
  side: number,
): boolean => {
  "worklet";
  const topLeft = { x: center.x - side / 2, y: center.y - side / 2 };
  return (
    value.x >= topLeft.x &&
    value.y >= topLeft.y &&
    value.x <= topLeft.x + side &&
    value.y <= topLeft.y + side
  );
};

// Create SVG arc path
export const arc = (
  x: number,
  y: number,
  large = false,
  sweep = false,
): string => {
  "worklet";
  return `A ${R} ${R} 0 ${large ? "1" : "0"} ${sweep ? "1" : "0"} ${x} ${y}`;
};
