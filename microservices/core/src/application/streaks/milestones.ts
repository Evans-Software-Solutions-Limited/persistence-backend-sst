/**
 * Streak milestone + freeze-token rules (06-progress-goals, Phase 06.2).
 * Per specs/_shared/cross-cuts.md § 3.5 (freeze tokens) + § 3.6 (milestones).
 * Pure — no DB, no clock. Fully unit-tested.
 */

import type { Period } from "./period";

/**
 * Milestone thresholds (cross-cuts § 3.6, locked 2026-05-25). Front-loads the
 * first ~3 months; intentionally stops after (intrinsically-motivated users
 * past 3 months don't need a push).
 */
export const MILESTONES = {
  weekly: [1, 2, 4, 8, 12],
  daily: [7, 14, 28, 60, 90],
} as const;

/** Weekly streaks (workout, measurement) use weekly tiers; others daily. */
export function milestonesForPeriod(period: Period): readonly number[] {
  return period === "weekly" ? MILESTONES.weekly : MILESTONES.daily;
}

/**
 * Thresholds crossed when a streak advances from `prevCount` to `newCount`
 * (exclusive of prev, inclusive of new). Usually 0 or 1 entries, but a
 * multi-step advance (e.g. cron backfill) can cross several at once.
 */
export function crossedMilestones(
  prevCount: number,
  newCount: number,
  period: Period,
): number[] {
  return milestonesForPeriod(period).filter(
    (t) => t > prevCount && t <= newCount,
  );
}

/** Freeze-token cap (cross-cuts § 3.5). Tokens earned over the cap are dropped. */
export const FREEZE_TOKEN_CAP = 4;

/** A token is earned every 4 successive completed periods. */
export const PERIODS_PER_FREEZE_TOKEN = 4;

/**
 * Freeze-token balance after a streak advances to `newCount`, given the
 * `existing` balance. Earns 1 token each time `newCount` lands on a multiple
 * of 4, capped at {@link FREEZE_TOKEN_CAP}. Never decrements (spend is the
 * cron's job).
 */
export function freezeTokensAfterAdvance(
  existing: number,
  newCount: number,
): number {
  const earned =
    newCount > 0 && newCount % PERIODS_PER_FREEZE_TOKEN === 0 ? 1 : 0;
  return Math.min(FREEZE_TOKEN_CAP, existing + earned);
}
