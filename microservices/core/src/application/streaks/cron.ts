/**
 * Nightly streak sweep (06-progress-goals, Phase 06.2). Per cross-cuts § 3.4
 * (item 2) + § 3.5. Scheduled at 02:00 UTC (infra/api.ts).
 *
 * The on-write engine (engine.ts) advances `last_period_end` whenever a period
 * is satisfied. So at sweep time, any active streak whose `last_period_end` is
 * behind the most-recently-completed user-local period has MISSED one or more
 * periods. One freeze token shields ONE missed period (§ 3.5), so for N missed:
 *   - freeze_tokens >= N → spend N, keep the streak alive, emit
 *     `freeze_token_applied`, fast-forward last_period_end. (Quiet recovery —
 *     no celebration; § 3.5.)
 *   - else               → break it (status='broken', current_count=0). No
 *     notification — `streak_lost` is not a defined notification type.
 *
 * Data access + notification are injected ports (testable without a DB or a
 * real clock).
 */

import type { UserStreak } from "@persistence/db";
import {
  lastCompletedPeriodEndISO,
  periodsBetween,
  type Period,
} from "./period";
import type { StreakNotifier } from "./engine";

export interface StreakCronDataPort {
  getActiveStreaks(): Promise<UserStreak[]>;
  getUserTimezone(userId: string): Promise<string>;
  /**
   * Both writers are CONDITIONAL and return null when no row matched — the
   * cron sweeps a snapshot taken at run start, so the on-write engine may have
   * already advanced a row mid-sweep (02:00 UTC is late morning across
   * Asia/Oceania). The guard pins the row to `snapshotLastPeriodEnd` (the
   * `last_period_end` the cron read and computed `tokensSpent`/the break
   * decision against), so a concurrent advance ANYWHERE — past the target OR
   * partway into the gap — yields a clean null rather than landing stale
   * arithmetic. A null means "advanced concurrently — nothing to
   * protect/break", never an error.
   */
  persistFreezeSpend(
    streakId: string,
    fields: {
      tokensSpent: number;
      lastPeriodEnd: string;
      snapshotLastPeriodEnd: string;
    },
  ): Promise<UserStreak | null>;
  persistBreak(
    streakId: string,
    fields: { lastPeriodEnd: string; snapshotLastPeriodEnd: string },
  ): Promise<UserStreak | null>;
}

export interface StreakCronDeps {
  data: StreakCronDataPort;
  notifier: StreakNotifier;
  /** Injected for deterministic tests; the handler passes `new Date()`. */
  now: Date;
}

export interface StreakCronSummary {
  swept: number;
  upToDate: number;
  frozen: number;
  broken: number;
  /**
   * Rows whose per-iteration processing threw (bad IANA `profiles.timezone`
   * → `RangeError`, a transient postgres error on the conditional UPDATE, or
   * a notification insert failure). Isolated so one poison row can't abort the
   * rest of the snapshot — same per-item discipline as `volumeCron`.
   */
  failed: number;
}

export async function streakCron(
  deps: StreakCronDeps,
): Promise<StreakCronSummary> {
  const streaks = await deps.data.getActiveStreaks();
  const summary: StreakCronSummary = {
    swept: streaks.length,
    upToDate: 0,
    frozen: 0,
    broken: 0,
    failed: 0,
  };

  // Memoise tz per user across the sweep — many streaks share a user.
  const tzCache = new Map<string, string>();
  const tzFor = async (userId: string): Promise<string> => {
    const cached = tzCache.get(userId);
    if (cached !== undefined) return cached;
    const tz = await deps.data.getUserTimezone(userId);
    tzCache.set(userId, tz);
    return tz;
  };

  for (const streak of streaks) {
    // Per-iteration isolation: a bad IANA tz (`RangeError`), a transient
    // postgres error on the conditional UPDATE, or a notification insert
    // failure must not abort the rest of the snapshot. Mirrors `volumeCron`'s
    // per-user try/catch (Inspector finding, PR #116) — without it a single
    // poison row aborts `streakCron` at the same index every night and nothing
    // past it ever gets swept.
    try {
      const period = streak.period as Period;
      const tz = await tzFor(streak.userId);
      const lastCompletedEnd = lastCompletedPeriodEndISO(deps.now, period, tz);

      // How many whole periods were missed since last_period_end. One freeze
      // token shields ONE missed period (cross-cuts § 3.5), so N missed periods
      // cost N tokens — and the streak breaks if there aren't enough to cover
      // them all. (Previously a single token absorbed an arbitrary gap.)
      const missed = periodsBetween(
        streak.lastPeriodEnd,
        lastCompletedEnd,
        period,
      );

      // Up to date: last_period_end is at or beyond the last completed period.
      if (missed <= 0) {
        summary.upToDate += 1;
        continue;
      }

      if (streak.freezeTokens >= missed) {
        const spent = await deps.data.persistFreezeSpend(streak.id, {
          tokensSpent: missed,
          lastPeriodEnd: lastCompletedEnd,
          snapshotLastPeriodEnd: streak.lastPeriodEnd,
        });
        if (!spent) {
          // Lost the race to an on-write advance — the row is no longer behind.
          summary.upToDate += 1;
          continue;
        }
        // The persist committed — the streak IS protected, so it counts as
        // `frozen` regardless of whether the notification lands. Isolate the
        // notify in its own try/catch: without it, a notify insert failure
        // would unwind to the outer catch and ALSO increment `failed`, so the
        // same row is double-counted and the summary buckets exceed `swept`
        // (Inspector finding — stats hygiene; CloudWatch alarms on the summary
        // line could double-fire).
        summary.frozen += 1;
        try {
          await deps.notifier.notify({
            userId: streak.userId,
            type: "freeze_token_applied",
            title: "Streak protected",
            message:
              missed === 1
                ? "You missed a period, so a freeze token kept your streak alive."
                : `You missed ${missed} periods, so ${missed} freeze tokens kept your streak alive.`,
            data: {
              streakType: streak.streakType,
              streakId: streak.id,
              periodsMissed: missed,
              tokensSpent: missed,
              freezeTokensRemaining: spent.freezeTokens,
            },
            relatedEntityId: streak.id,
          });
        } catch (err) {
          console.error("[streak-cron] freeze notification failed", {
            streakId: streak.id,
            userId: streak.userId,
            error: err,
          });
        }
      } else {
        // Not enough tokens to cover every missed period → the streak breaks.
        // A null here likewise means an on-write advance landed mid-sweep.
        const broke = await deps.data.persistBreak(streak.id, {
          lastPeriodEnd: lastCompletedEnd,
          snapshotLastPeriodEnd: streak.lastPeriodEnd,
        });
        if (!broke) {
          summary.upToDate += 1;
          continue;
        }
        summary.broken += 1;
      }
    } catch (err) {
      summary.failed += 1;
      console.error("[streak-cron] sweep failed for streak", {
        streakId: streak.id,
        userId: streak.userId,
        error: err,
      });
    }
  }

  return summary;
}
