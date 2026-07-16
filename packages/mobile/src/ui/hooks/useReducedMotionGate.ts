import { useReducedMotion } from "react-native-reanimated";

/**
 * Single source of truth for the reduce-motion contract (spec-12.2, STORY-003).
 *
 * Every animated foundation primitive (`Ring`/`MultiRing`, `Bar`, `TabBar`,
 * `BottomSheet`, `ActiveWorkoutBar`) reads its animation budget from this hook
 * instead of calling `useReducedMotion()` + hardcoding durations locally — so
 * the OS "Reduce Motion" setting is honoured consistently and there's one place
 * to audit (design.md § Reduced-motion contract; T-12.2.1).
 *
 * The millisecond values mirror the durations the primitives used before this
 * hook existed (ring 800, bar 600, tab-accent 200), so wiring a primitive onto
 * the gate is behaviour-preserving when reduce-motion is OFF and instant when
 * it's ON.
 */
export type MotionGate = {
  /** True when the OS "Reduce Motion" accessibility setting is enabled. */
  reduced: boolean;
  /** Ring fill sweep duration — 0 when reduced, 800ms otherwise. */
  ringFillMs: number;
  /** Bar fill sweep duration — 0 when reduced, 600ms otherwise. */
  barFillMs: number;
  /** BottomSheet open/close: slide (animated) vs snap (instant). */
  sheetAnimation: "slide" | "snap";
  /** Whether looping "pulse" affordances (e.g. the active-workout dot) run. */
  pulseDots: boolean;
  /** TabBar accent crossfade (cyan ↔ violet) duration — 0 when reduced, 200ms. */
  tabAccentMs: number;
};

export function useReducedMotionGate(): MotionGate {
  const reduced = useReducedMotion();
  return {
    reduced,
    ringFillMs: reduced ? 0 : 800,
    barFillMs: reduced ? 0 : 600,
    sheetAnimation: reduced ? "snap" : "slide",
    pulseDots: !reduced,
    tabAccentMs: reduced ? 0 : 200,
  };
}
