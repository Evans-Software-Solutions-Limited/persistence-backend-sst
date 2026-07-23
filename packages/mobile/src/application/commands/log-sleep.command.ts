/**
 * Log-sleep command — offline-first (specs/20-sleep-quicklog STORY-001 AC
 * 1.3/1.4). Enqueues the durable POST /health/sleep on the sync queue (the
 * offline-durability mechanism here — there is no local read-cache for
 * sleep, unlike `logMeasurementCommand`'s body-trend cache, which a LIST
 * hook reads back; the Sleep sheet prefills from HealthKit and the Home
 * pill is server-driven, so nothing locally reads a cached sleep row). The
 * backend upserts by `(userId, sleepDate, 'manual')`, so re-saving the same
 * day overwrites rather than duplicating (AC 1.4) — a reconnect replay of
 * the queued POST is therefore safe (idempotent day-keyed upsert, unlike
 * `/sessions/record` which creates a new row on every call).
 *
 * Also BRIDGES the log to the Sleep HABIT (BRIEF-7 QA-1..QA-4, mirrors the
 * water-litres-habit-bridge in `nutrition.command.ts`): the Sleep habit's
 * target is in HOURS, but a log is in MINUTES, so logging used to never tick
 * the habit. After enqueuing the sleep record we reflect the habit's binary
 * nightly threshold — a completion exists for `sleepDate` iff the logged
 * duration (minutes ÷ 60) meets the habit's `targetValue` (hours). See
 * `reflectSleepHabit`.
 */

import type { StoragePort } from "@/domain/ports/storage.port";
import type { LogSleepInput } from "@/domain/ports/api.port";
import { fail, ok, type Result, type ValidationError } from "@/shared/errors";
import { setHabitCompletion } from "@/application/commands/toggle-habit.command";

export type LogSleepCommandDeps = {
  storage: StoragePort;
  userId: string;
  /** Stable id for the habit-bridge's optimistic local row. */
  idFactory: () => string;
};

export function logSleepCommand(
  deps: LogSleepCommandDeps,
  input: LogSleepInput,
): Result<void, ValidationError> {
  // Mirrors the backend's `(0, 1440]` validation (healthSleepPostHandler) —
  // keep an invalid entry out of the queue entirely rather than letting the
  // sync worker discover a 422 with no feedback loop back to the user.
  if (
    !Number.isFinite(input.durationMinutes) ||
    input.durationMinutes <= 0 ||
    input.durationMinutes > 1440
  ) {
    return fail({
      kind: "validation",
      fields: { durationMinutes: "Enter a realistic sleep duration." },
    });
  }

  deps.storage.enqueueMutation({
    entityType: "sleep",
    entityId: input.sleepDate,
    operation: "create",
    payload: input,
    endpoint: "/health/sleep",
    method: "POST",
  });

  deps.storage.invalidateHome(deps.userId);
  reflectSleepHabit(deps, input.sleepDate, input.durationMinutes / 60);
  return ok(undefined);
}

/**
 * Reflect a night's sleep duration into the Sleep HABIT completion (binary
 * nightly threshold). No-op unless the user has an ACTIVE, enabled sleep
 * habit with a real `goalId` and an hours `targetValue`.
 *
 * - logged hours (`durationMinutes / 60`) ≥ target → ensure the night is
 *   ticked with `value = targetValue` (hours) — identical to the Home grid
 *   tile's write, so tile + log stay consistent.
 * - below target → ensure the night is un-ticked.
 *
 * Idempotent: only enqueues a POST when not already ticked, only a DELETE
 * when currently ticked — checked against the cached completions for that
 * night — so re-saving the same duration doesn't spam the queue. Invalidates
 * Home once when the tick state actually changed so the grid re-reads it.
 */
function reflectSleepHabit(
  deps: LogSleepCommandDeps,
  sleepDate: string,
  hours: number,
): void {
  const { storage, userId } = deps;

  const sleep = storage
    .getHabitConfigs(userId)
    .find((c) => c.category === "sleep");
  if (!sleep || !sleep.enabled || !sleep.goalId) return;

  const goalId = sleep.goalId;
  const target = sleep.targetValue;
  const shouldTick = hours >= target;

  const alreadyTicked = storage
    .getCachedHabitCompletions(userId, { goalId })
    .some(
      (r) => (r.localCompletedDate ?? r.completedAt.slice(0, 10)) === sleepDate,
    );

  // No state change → don't touch the cache or queue (idempotent).
  if (shouldTick === alreadyTicked) return;

  setHabitCompletion(storage, {
    userId,
    goalId,
    day: sleepDate,
    done: shouldTick,
    // value_gte habit — the completion carries the hours target, matching
    // the grid tile so the backend's onConflictDoNothing sees a constant
    // value.
    value: shouldTick ? target : undefined,
    idFactory: deps.idFactory,
  });

  storage.invalidateHome(userId);
}
