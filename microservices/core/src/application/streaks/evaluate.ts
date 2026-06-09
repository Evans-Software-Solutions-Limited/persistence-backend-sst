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

export async function safeEvaluateStreaks(
  userId: string,
  eventType: StreakEventType,
  ts: Date,
): Promise<EvaluateResult> {
  try {
    return await evaluateStreaks(userId, eventType, ts, {
      data: new StreakRepository(),
      notifier: new StreakNotificationDispatcher(),
    });
  } catch (err) {
    console.error("[streaks] on-write evaluation failed", {
      userId,
      eventType,
      error: err,
    });
    return EMPTY;
  }
}
