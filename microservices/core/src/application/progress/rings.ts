/**
 * TodayHero ring composition (06-progress-goals, Phase 06.5; STORY-001).
 * Pure — no DB. All three rings are DAILY and reset at the user's local
 * midnight:
 *   Move  = daily steps / goal steps            (HealthKit, daily_activity_data)
 *   Train = daily active kcal / goal active kcal (HealthKit active energy)
 *   Fuel  = daily kcal eaten / target kcal      (M9 — live once a target is set;
 *                                                "gated" until the user has one)
 *
 * ⚠ Train changed 2026-07-28, superseding decision #2 (which defined it as
 * WEEKLY lifted volume / 20 t). Two problems with that:
 *   • It was the only non-daily ring, so it never reset with the other two —
 *     a "today" hero showing a Monday-to-Sunday accumulator.
 *   • Against a flat 20 t target a single heavy session reads ~45%, so the
 *     ring was effectively uncloseable and stopped meaning anything.
 * Weekly volume is NOT lost — it is still the Home weekly-volume card and the
 * You-tab VolumeStats (monthly total + by-muscle), which is where a
 * multi-day accumulator belongs.
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

/**
 * Ring inputs. An OBJECT rather than positional args on purpose: Move and Train
 * are both `(current, goal)` number pairs, so a positional signature let the
 * Train pair silently change meaning (weekly kg → daily kcal) with every call
 * site still type-checking. Named fields make that a compile error instead.
 */
export interface BuildRingsInput {
  /** Steps today (user-local day). */
  steps: number;
  /** Daily step goal — the user's Steps habit target where they have one. */
  goalSteps: number;
  /** Active energy burned today, kcal (user-local day). */
  activeKcal: number;
  /** Daily active-energy goal, kcal. */
  goalActiveKcal: number;
  /**
   * Nutrition for the Fuel ring. `null` (or a non-positive target) keeps the
   * ring "gated" — the user hasn't set a daily kcal target yet, so there's
   * nothing to ratio against and the Home ring prompts them via the "--" state.
   */
  fuel?: FuelInput | null;
}

export function buildRings({
  steps,
  goalSteps,
  activeKcal,
  goalActiveKcal,
  fuel: fuelInput = null,
}: BuildRingsInput): Rings {
  const move: RingDatum = {
    current: steps,
    target: goalSteps,
    pct: ratio(steps, goalSteps),
    unit: "steps",
  };
  const train: RingDatum = {
    current: activeKcal,
    target: goalActiveKcal,
    pct: ratio(activeKcal, goalActiveKcal),
    unit: "kcal",
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
