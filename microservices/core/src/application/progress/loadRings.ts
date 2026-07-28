/**
 * Loads the TodayHero ring inputs (06-progress-goals, Phase 06.5). Shared by
 * GET /users/me/today-rings and GET /users/me/home. Takes the repos as deps so
 * it stays testable without a DB.
 */

import { localDateISO } from "../streaks/period";
import { buildRings, type Rings } from "./rings";

/**
 * Fallback daily goals, used only when the user has no goal of their own.
 *
 * `DEFAULT_GOAL_STEPS` is now a FALLBACK rather than the value: a user with a
 * Steps habit configured has already told us their daily step target, so the
 * Move ring reads that instead of assuming 10k (see `getDailyStepsGoal`).
 *
 * `DEFAULT_GOAL_ACTIVE_KCAL` has no such source yet and is a deliberate
 * stopgap. 500 kcal matches Apple's default Move goal. The habit categories are
 * `water | gym | steps | sleep | calories`, and `calories` there is NUTRITION
 * intake (completion rule `within_tolerance`, feeding the Fuel ring) — not
 * energy burned, so it must NOT be reused here. Giving active energy a real
 * per-user goal means either a new habit category or a general ring-goal store;
 * that is its own slice, and it should cover steps and active energy together.
 */
export const DEFAULT_GOAL_STEPS = 10000;
export const DEFAULT_GOAL_ACTIVE_KCAL = 500;

export interface RingPorts {
  getUserTimezone(userId: string): Promise<string>;
  getTodaySteps(userId: string, todayLocalISO: string): Promise<number>;
  /** Active energy burned today, kcal (Train ring numerator). */
  getTodayActiveKcal(userId: string, todayLocalISO: string): Promise<number>;
  /**
   * The user's own daily step goal from their Steps habit, or null when they
   * have no active one (→ DEFAULT_GOAL_STEPS).
   */
  getDailyStepsGoal(userId: string): Promise<number | null>;
  /** kcal logged for the user-local day (Fuel ring numerator). */
  sumKcalForDay(userId: string, todayLocalISO: string): Promise<number>;
  /** Daily kcal target, or null when the user hasn't set one (→ Fuel gated). */
  getDailyKcalTarget(userId: string): Promise<number | null>;
}

export async function loadRings(
  ports: RingPorts,
  userId: string,
  now: Date,
): Promise<Rings> {
  const tz = await ports.getUserTimezone(userId);
  const today = localDateISO(now, tz);

  const [steps, stepsGoal, activeKcal, kcal, kcalTarget] = await Promise.all([
    ports.getTodaySteps(userId, today),
    ports.getDailyStepsGoal(userId),
    ports.getTodayActiveKcal(userId, today),
    ports.sumKcalForDay(userId, today),
    ports.getDailyKcalTarget(userId),
  ]);

  return buildRings({
    steps,
    // A non-positive habit target would zero the ring rather than scale it;
    // the column has a `> 0` check, but the guard keeps this total.
    goalSteps:
      stepsGoal != null && stepsGoal > 0 ? stepsGoal : DEFAULT_GOAL_STEPS,
    activeKcal,
    goalActiveKcal: DEFAULT_GOAL_ACTIVE_KCAL,
    fuel: kcalTarget !== null ? { consumed: kcal, target: kcalTarget } : null,
  });
}
