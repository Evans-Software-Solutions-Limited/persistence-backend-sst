/**
 * Fire-and-forget streak evaluation for write handlers (06-progress-goals,
 * Phase 06.3). Wraps {@link evaluateStreaks} with the real DB + notifier
 * ports and swallows errors — exactly mirroring the inline PR-detection
 * pattern in sessionsUpdateHandler: the user's write already committed, so a
 * streak-engine failure must never fail the request or roll anything back.
 * The nightly cron reconciles anything a dropped on-write run missed.
 */

import {
  evaluateStreaks,
  type EvaluateResult,
  type StreakEventType,
} from "./engine";
import { StreakRepository } from "../repositories/streakRepository";
import { StreakNotificationDispatcher } from "./notifier";

const EMPTY: EvaluateResult = { advanced: [], milestones: [] };

/**
 * Resolve a client-supplied `completedAt` into a safe event timestamp for the
 * streak engine: never in the future (clamped to `now`) and never `NaN` (falls
 * back to `now`). A future-dated `completedAt` would otherwise let `tryAdvance`
 * push `last_period_end` into a future period, so the nightly cron sees the
 * streak as "up to date" and never breaks the genuinely-missed periods in
 * between (Inspector finding, PR #116). Pure + injectable clock for tests.
 */
export function resolveEventTs(value: unknown, now: Date = new Date()): Date {
  if (typeof value !== "string") return now;
  const d = new Date(value);
  if (Number.isNaN(d.getTime()) || d.getTime() > now.getTime()) return now;
  return d;
}

/**
 * @param localDate Optional authoritative user-local day (YYYY-MM-DD) for
 *   date-only events (a habit grid cell). When supplied, the engine evaluates
 *   the period against this day instead of re-deriving it from `ts` — the
 *   handler's noon-UTC anchor drifts to the next local day for any tz ≥ +12, so
 *   re-deriving would target the wrong period (Inspector finding, PR #116).
 */
export async function safeEvaluateStreaks(
  userId: string,
  eventType: StreakEventType,
  ts: Date,
  localDate?: string,
): Promise<EvaluateResult> {
  try {
    const data = new StreakRepository();
    // M4 shipped workout achievements without ever creating the row they
    // evaluate. Create it lazily on the first completed session (or the
    // achievements reconciliation read) before asking the engine to advance.
    if (eventType === "workout_logged") {
      await data.ensureWorkoutStreak(userId, ts);
    }
    return await evaluateStreaks(
      userId,
      eventType,
      ts,
      {
        data,
        notifier: new StreakNotificationDispatcher(),
      },
      { localDate },
    );
  } catch (err) {
    console.error("[streaks] on-write evaluation failed", {
      userId,
      eventType,
      error: err,
    });
    return EMPTY;
  }
}

/**
 * Idempotent repair for accounts whose workout streak row was absent while
 * completed sessions were being recorded. Called before achievements are read
 * so historical weekly milestones become visible without requiring a new
 * workout. Failures stay non-blocking, matching the on-write evaluator.
 */
export async function safeReconcileWorkoutStreak(
  userId: string,
): Promise<void> {
  try {
    const data = new StreakRepository();
    await data.reconcileWorkoutStreakHistory(userId);
  } catch (err) {
    console.error("[streaks] workout reconciliation failed", {
      userId,
      error: err,
    });
  }
}
