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
