/**
 * TodayHero ring composition (06-progress-goals, Phase 06.5; STORY-001).
 * Pure — no DB. Per locked decision #2:
 *   Move  = daily steps / goal steps          (HealthKit, daily_activity_data)
 *   Train = weekly volume kg / target kg       (useGetWeeklyVolume; AC 1.2)
 *   Fuel  = daily kcal / target kcal           (M9-gated → "gated" until then)
 *
 * NB: the May-2026 prototype renders TRAIN as "38 min"; the SPEC (decision #2 +
 * AC 1.2) defines Train as weekly volume. Spec wins — flagged for the frontend
 * phase to reconcile the RingLegend label/sub.
 */

export interface RingDatum {
  current: number;
  target: number;
  pct: number; // 0..1
  unit: string;
}

export interface Rings {
  move: RingDatum;
  train: RingDatum;
  fuel: RingDatum | "gated";
  /** Centre TODAY% — average of the non-gated rings (AC 1.4), 0..100. */
  todayPct: number;
}

/** Clamp a current/target ratio to [0, 1]; 0 when the target is non-positive. */
export function ratio(current: number, target: number): number {
  if (target <= 0) return 0;
  return Math.min(1, Math.max(0, current / target));
}

export function buildRings(
  steps: number,
  goalSteps: number,
  weekKg: number,
  targetKg: number,
): Rings {
  const move: RingDatum = {
    current: steps,
    target: goalSteps,
    pct: ratio(steps, goalSteps),
    unit: "steps",
  };
  const train: RingDatum = {
    current: weekKg,
    target: targetKg,
    pct: ratio(weekKg, targetKg),
    unit: "kg",
  };
  // Fuel gates on M9 (nutrition); until then the ring shows 0% + "--".
  const fuel = "gated" as const;
  const todayPct = Math.round(((move.pct + train.pct) / 2) * 100);
  return { move, train, fuel, todayPct };
}
