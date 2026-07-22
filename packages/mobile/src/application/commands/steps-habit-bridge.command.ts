/**
 * Steps-habit bridge (BRIEF-7 QA-1..QA-4) — mirrors the water-litres-habit-
 * bridge in `nutrition.command.ts` (see `reflectWaterHabit`) and the sleep
 * bridge in `log-sleep.command.ts` (`reflectSleepHabit`).
 *
 * Unlike water/sleep, there is no explicit "log steps" user action — steps
 * are a passive HealthKit read (`useHealthData().stepsToday`) that changes
 * over the day as the device syncs. So this bridge has no `command` in the
 * usual sense: it's a pure reflect function, triggered reactively from an
 * effect keyed on the steps value (see `useReflectStepsHabit`), not from a
 * user-initiated mutation hook.
 *
 * Direction per specs/18-habit-setup/design.md § 7.3: Steps is READ-ONLY from
 * HealthKit (device-tracked) — the device never WRITES to HealthKit for
 * steps, it only reads today's count and reflects it into the DB-backed
 * habit completion, same as water/sleep do for their own values.
 */

import type { StoragePort } from "@/domain/ports/storage.port";
import { setHabitCompletion } from "@/application/commands/toggle-habit.command";

export type StepsHabitBridgeDeps = {
  storage: StoragePort;
  userId: string;
  /** Stable id for the optimistic local row. */
  idFactory: () => string;
};

/**
 * Reflect today's HealthKit step count into the Steps HABIT completion
 * (binary daily threshold). No-op unless the user has an ACTIVE, enabled
 * steps habit with a real `goalId` and a steps `targetValue`.
 *
 * - steps ≥ target → ensure TODAY is ticked with `value = targetValue`
 *   (steps) — identical to the Home grid tile's write.
 * - below target → ensure TODAY is un-ticked.
 *
 * Idempotent + best-effort: only enqueues a POST when not already ticked,
 * only a DELETE when currently ticked — checked against the cached
 * completions for today — so repeated reactive reads at a steady state (the
 * common case: steps only rises through the day) don't spam the queue or
 * double-write once ticked. Offline-safe: this only touches the local cache
 * + sync queue, never makes a direct network call itself.
 */
export function reflectStepsHabit(
  deps: StepsHabitBridgeDeps,
  date: string,
  steps: number,
): void {
  const { storage, userId } = deps;

  const stepsHabit = storage
    .getHabitConfigs(userId)
    .find((c) => c.category === "steps");
  if (!stepsHabit || !stepsHabit.enabled || !stepsHabit.goalId) return;

  const goalId = stepsHabit.goalId;
  const target = stepsHabit.targetValue;
  const shouldTick = steps >= target;

  const alreadyTicked = storage
    .getCachedHabitCompletions(userId, { goalId })
    .some((r) => (r.localCompletedDate ?? r.completedAt.slice(0, 10)) === date);

  // No state change → don't touch the cache or queue (idempotent — also the
  // guard that stops every subsequent reactive read from re-writing once the
  // day is already ticked, or repeatedly deleting when it's already off).
  if (shouldTick === alreadyTicked) return;

  setHabitCompletion(storage, {
    userId,
    goalId,
    day: date,
    done: shouldTick,
    // value_gte habit — the completion carries the steps target, matching
    // the grid tile so the backend's onConflictDoNothing sees a constant
    // value.
    value: shouldTick ? target : undefined,
    idFactory: deps.idFactory,
  });

  storage.invalidateHome(userId);
}
