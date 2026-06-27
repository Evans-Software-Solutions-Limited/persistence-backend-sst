/**
 * TodayHero ring composition (06-progress-goals, Phase 06.5; STORY-001).
 * Pure — no DB. Per locked decision #2:
 *   Move  = daily steps / goal steps          (HealthKit, daily_activity_data)
 *   Train = weekly volume kg / target kg       (useGetWeeklyVolume; AC 1.2)
 *   Fuel  = daily kcal / target kcal           (M9 — live once a target is set;
 *                                               "gated" until the user has one)
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

/** The day's nutrition input for the Fuel ring. */
export interface FuelInput {
  /** kcal logged today. */
  consumed: number;
  /** Daily kcal target (from nutrition_targets). */
  target: number;
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
  /**
   * Nutrition for the Fuel ring. `null` (or a non-positive target) keeps the
   * ring "gated" — the user hasn't set a daily kcal target yet, so there's
   * nothing to ratio against and the Home ring prompts them via the "--" state.
   * Defaulted so existing callers/tests stay valid.
   */
  fuelInput: FuelInput | null = null,
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
  // Fuel is live once the user has a daily kcal target; otherwise gated.
  const fuel: RingDatum | "gated" =
    fuelInput && fuelInput.target > 0
      ? {
          current: fuelInput.consumed,
          target: fuelInput.target,
          pct: ratio(fuelInput.consumed, fuelInput.target),
          unit: "kcal",
        }
      : "gated";
  // TODAY% averages the NON-gated rings (AC 1.4) — Fuel joins once it's live.
  const pcts = [move.pct, train.pct, ...(fuel !== "gated" ? [fuel.pct] : [])];
  const todayPct = Math.round(
    (pcts.reduce((a, b) => a + b, 0) / pcts.length) * 100,
  );
  return { move, train, fuel, todayPct };
}
