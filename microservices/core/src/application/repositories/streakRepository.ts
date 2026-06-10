import { and, eq, sql } from "drizzle-orm";
import {
  achievements,
  bodyMeasurements,
  habitCompletions,
  profiles,
  userAchievements,
  userGoals,
  userStreaks,
  workoutSessions,
  type UserStreak,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";
import type {
  StreakAdvanceFields,
  StreakDataPort,
  StreakType,
} from "../streaks/engine";
import type { StreakCronDataPort } from "../streaks/cron";
import {
  lastCompletedPeriodEndISO,
  periodsBetween,
  periodEndForDateISO,
  periodStartFromEndISO,
  previousPeriodEndISO,
  type Period,
} from "../streaks/period";

/**
 * DB-backed implementation of the streak engine + cron data ports
 * (06-progress-goals, Phase 06.2). All user-local time handling is pushed
 * into Postgres via `AT TIME ZONE` so the JS side only deals in instants and
 * calendar-date strings (see streaks/period.ts).
 *
 * Ownership: every query is scoped by `user_id`. Streak rows carry their own
 * userId, so the engine reads it from the row, never from a request body.
 */
export class StreakRepository implements StreakDataPort, StreakCronDataPort {
  static readonly key = "StreakRepository";

  async getUserTimezone(userId: string): Promise<string> {
    const db = getDb();
    const rows = await db
      .select({ tz: profiles.timezone })
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);
    return rows[0]?.tz ?? "Europe/London";
  }

  /**
   * Streaks the on-write engine should evaluate: `active` AND `broken`.
   * Broken streaks are included so the next satisfied period RESTARTS them at
   * count 1 (persistBreak zeroes current_count, so the engine's `+1` lands on
   * 1 and persistAdvance flips status back to 'active') — without this a
   * broken streak was a terminal dead end, since nothing else creates or
   * revives user_streaks rows (Inspector finding, PR #116). `paused` stays
   * excluded — pause semantics are explicit user intent (cross-cuts § 3.5).
   */
  async getActiveStreaksByType(
    userId: string,
    streakType: StreakType,
  ): Promise<UserStreak[]> {
    const db = getDb();
    return db
      .select()
      .from(userStreaks)
      .where(
        and(
          eq(userStreaks.userId, userId),
          eq(userStreaks.streakType, streakType),
          sql`${userStreaks.status} IN ('active','broken')`,
        ),
      );
  }

  async getActiveStreaks(): Promise<UserStreak[]> {
    const db = getDb();
    return db
      .select()
      .from(userStreaks)
      .where(eq(userStreaks.status, "active"));
  }

  async isPeriodSatisfied(
    streak: UserStreak,
    startDate: string,
    endDate: string,
    tz: string,
  ): Promise<boolean> {
    const db = getDb();

    if (streak.streakType === "workout_streak") {
      // ≥ N completed sessions in the window; N = source goal's target_value
      // (default 1 for ad-hoc / unset goals).
      const n = await this.resolveWorkoutThreshold(streak.sourceGoalId);
      const rows = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(workoutSessions)
        .where(
          and(
            eq(workoutSessions.userId, streak.userId),
            eq(workoutSessions.status, "completed"),
            sql`(${workoutSessions.completedAt} AT TIME ZONE ${tz})::date BETWEEN ${startDate} AND ${endDate}`,
          ),
        );
      return (rows[0]?.c ?? 0) >= n;
    }

    if (streak.streakType === "habit_streak") {
      // ≥ 1 completion for the source goal in the window. Buckets by the
      // STORED local_completed_date (written from the user's tz at insert
      // time) rather than re-deriving from completed_at — re-deriving with the
      // CURRENT profile tz desyncs from the dedup key after a timezone change
      // (Inspector finding, PR #116), and the stored column is what the
      // unique index + grid use.
      const rows = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(habitCompletions)
        .where(
          and(
            eq(habitCompletions.userId, streak.userId),
            streak.sourceGoalId
              ? eq(habitCompletions.goalId, streak.sourceGoalId)
              : sql`true`,
            sql`${habitCompletions.localCompletedDate} BETWEEN ${startDate} AND ${endDate}`,
          ),
        );
      return (rows[0]?.c ?? 0) >= 1;
    }

    if (streak.streakType === "measurement_streak") {
      // ≥ 1 body measurement in the window.
      const rows = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(bodyMeasurements)
        .where(
          and(
            eq(bodyMeasurements.userId, streak.userId),
            sql`(${bodyMeasurements.measuredAt} AT TIME ZONE ${tz})::date BETWEEN ${startDate} AND ${endDate}`,
          ),
        );
      return (rows[0]?.c ?? 0) >= 1;
    }

    // nutrition_streak — M9-gated. No nutrition_entries table yet, so it can
    // never be satisfied; nutrition streaks simply won't advance until M9.
    return false;
  }

  private async resolveWorkoutThreshold(
    sourceGoalId: string | null,
  ): Promise<number> {
    if (!sourceGoalId) return 1;
    const db = getDb();
    const rows = await db
      .select({ tv: userGoals.targetValue })
      .from(userGoals)
      .where(eq(userGoals.id, sourceGoalId))
      .limit(1);
    const tv = rows[0]?.tv != null ? Number(rows[0].tv) : NaN;
    return Number.isFinite(tv) && tv > 0 ? Math.ceil(tv) : 1;
  }

  async persistAdvance(
    streakId: string,
    fields: StreakAdvanceFields,
  ): Promise<UserStreak> {
    const db = getDb();
    const rows = await db
      .update(userStreaks)
      .set({
        currentCount: fields.currentCount,
        longestCount: fields.longestCount,
        lastPeriodEnd: fields.lastPeriodEnd,
        freezeTokens: fields.freezeTokens,
        status: "active",
        updatedAt: new Date(),
      })
      .where(eq(userStreaks.id, streakId))
      .returning();
    return rows[0];
  }

  async unlockAchievement(
    userId: string,
    streakType: StreakType,
    threshold: number,
  ): Promise<{ achievementId: string; newlyUnlocked: boolean } | null> {
    const db = getDb();

    // Resolve the seeded achievement by (category, requirements) jsonb equality
    // — order-insensitive because jsonb is stored normalised.
    const requirements = JSON.stringify({ streak_type: streakType, threshold });
    const found = await db
      .select({ id: achievements.id })
      .from(achievements)
      .where(
        and(
          eq(achievements.category, "streak"),
          sql`${achievements.requirements} = ${requirements}::jsonb`,
        ),
      )
      .limit(1);

    const achievementId = found[0]?.id;
    if (!achievementId) return null;

    // Idempotent unlock — UNIQUE (user_id, achievement_id). A duplicate
    // returns no rows, so newlyUnlocked=false (the milestone already fired).
    const inserted = await db
      .insert(userAchievements)
      .values({ userId, achievementId })
      .onConflictDoNothing()
      .returning({ id: userAchievements.id });

    return { achievementId, newlyUnlocked: inserted.length > 0 };
  }

  /**
   * Cron freeze-spend. Conditional + relative: the cron sweeps a snapshot
   * taken at run start, so by the time it reaches a row the on-write engine
   * may already have spent the gap tokens and advanced `last_period_end`
   * (02:00 UTC is late morning across Asia/Oceania — peak logging time).
   * Guarding on `last_period_end < target` + decrementing relatively makes a
   * lost race a clean no-op (returns null) instead of regressing the streak
   * and double-spending (Inspector finding, PR #116).
   */
  async persistFreezeSpend(
    streakId: string,
    fields: { tokensSpent: number; lastPeriodEnd: string },
  ): Promise<UserStreak | null> {
    const db = getDb();
    const rows = await db
      .update(userStreaks)
      .set({
        freezeTokens: sql`${userStreaks.freezeTokens} - ${fields.tokensSpent}`,
        lastPeriodEnd: fields.lastPeriodEnd,
        status: "active",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(userStreaks.id, streakId),
          eq(userStreaks.status, "active"),
          sql`${userStreaks.freezeTokens} >= ${fields.tokensSpent}`,
          sql`${userStreaks.lastPeriodEnd} < ${fields.lastPeriodEnd}`,
        ),
      )
      .returning();
    return rows[0] ?? null;
  }

  /**
   * Break a streak that fell behind. Conditional for the same snapshot-race
   * reason as persistFreezeSpend: if the engine advanced the row past the
   * cron's target while the sweep was running, breaking it now would zero a
   * streak the user just satisfied — the guard turns that into a no-op null.
   */
  async persistBreak(
    streakId: string,
    fields: { lastPeriodEnd: string },
  ): Promise<UserStreak | null> {
    const db = getDb();
    const rows = await db
      .update(userStreaks)
      .set({
        status: "broken",
        currentCount: 0,
        lastPeriodEnd: fields.lastPeriodEnd,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(userStreaks.id, streakId),
          eq(userStreaks.status, "active"),
          sql`${userStreaks.lastPeriodEnd} < ${fields.lastPeriodEnd}`,
        ),
      )
      .returning();
    return rows[0] ?? null;
  }

  /**
   * Conditionally roll back a habit-streak advance after a completion is
   * untoggled (DELETE /habit-completions). Fires only when (a) the streak's
   * `last_period_end` is exactly the period the deleted completion satisfied
   * and (b) no OTHER completion still satisfies that period — then decrements
   * `current_count` and regresses `last_period_end` one period. Without this,
   * tap-untap left a permanently advanced streak with zero completion rows
   * behind it — an empty grid next to a climbing counter (Inspector finding,
   * PR #116). Earned freeze tokens are NOT clawed back (conservative; the cap
   * limits the upside). Returns the rolled-back row or null (nothing to do).
   */
  async rollbackHabitAdvance(
    userId: string,
    goalId: string,
    localDay: string,
  ): Promise<UserStreak | null> {
    const db = getDb();

    // The period grain (daily vs weekly) lives on the streak row.
    const streaks = await db
      .select()
      .from(userStreaks)
      .where(
        and(
          eq(userStreaks.userId, userId),
          eq(userStreaks.sourceGoalId, goalId),
          eq(userStreaks.streakType, "habit_streak"),
          eq(userStreaks.status, "active"),
        ),
      )
      .limit(1);
    const streak = streaks[0];
    if (!streak) return null;

    const period = streak.period as Period;
    const periodEnd = periodEndForDateISO(localDay, period);
    // Only the MOST RECENTLY counted period can be rolled back — earlier
    // periods are already locked into current_count history.
    if (streak.lastPeriodEnd !== periodEnd) return null;

    const periodStart = periodStartFromEndISO(periodEnd, period);
    const prevPeriodEnd = previousPeriodEndISO(periodEnd, period);

    const rows = await db
      .update(userStreaks)
      .set({
        currentCount: sql`GREATEST(${userStreaks.currentCount} - 1, 0)`,
        lastPeriodEnd: prevPeriodEnd,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(userStreaks.id, streak.id),
          eq(userStreaks.status, "active"),
          // Re-checked in the WHERE for race safety vs a concurrent advance.
          eq(userStreaks.lastPeriodEnd, periodEnd),
          sql`NOT EXISTS (
            SELECT 1 FROM habit_completions hc
            WHERE hc.user_id = ${userId}
              AND hc.goal_id = ${goalId}
              AND hc.local_completed_date BETWEEN ${periodStart} AND ${periodEnd}
          )`,
        ),
      )
      .returning();
    return rows[0] ?? null;
  }

  /**
   * Manual freeze-token spend (06.5 — the You/Progress "Use" button). Spends one
   * token PER missed period to PROTECT a behind streak: it decrements
   * `freeze_tokens` by `missed` AND fast-forwards `last_period_end` to the last
   * completed user-local period (mirroring the cron's `persistFreezeSpend` cost
   * exactly — cross-cuts § 3.5). Without the `last_period_end` advance the
   * nightly cron would re-detect the miss and break the streak; without the
   * per-period cost the manual path would be strictly cheaper than the cron
   * (Inspector findings, PR #116).
   *
   * Returns null (→ handler 400) when: the streak isn't owned by `userId`, is
   * not `active` (a broken/paused streak keeps its leftover tokens, but reviving
   * it would just mint a zombie active/count=0 streak), isn't actually behind
   * (no token wasted), OR doesn't have enough tokens to cover every missed
   * period (the cron will break it — manual can't partially protect).
   *
   * `now` is injectable for deterministic tests.
   */
  async spendTokenManually(
    userId: string,
    streakId: string,
    now: Date = new Date(),
  ): Promise<UserStreak | null> {
    const db = getDb();
    const existing = await db
      .select()
      .from(userStreaks)
      .where(
        and(
          eq(userStreaks.id, streakId),
          eq(userStreaks.userId, userId),
          eq(userStreaks.status, "active"),
        ),
      )
      .limit(1);
    const streak = existing[0];
    if (!streak) return null;

    const tz = await this.getUserTimezone(userId);
    const period = streak.period as Period;
    const lastCompletedEnd = lastCompletedPeriodEndISO(now, period, tz);
    // One token shields ONE missed period (cross-cuts § 3.5), matching the cron
    // — so a manual spend costs `missed` tokens, not a flat 1. Bail (→ 400)
    // when nothing's missed (no token wasted) OR there aren't enough tokens to
    // cover every missed period (the cron will break it; manual can't partially
    // protect). This keeps the manual + automatic paths symmetric.
    const missed = periodsBetween(
      streak.lastPeriodEnd,
      lastCompletedEnd,
      period,
    );
    if (missed <= 0 || streak.freezeTokens < missed) return null;

    const rows = await db
      .update(userStreaks)
      .set({
        freezeTokens: sql`${userStreaks.freezeTokens} - ${missed}`,
        lastPeriodEnd: lastCompletedEnd,
        status: "active",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(userStreaks.id, streakId),
          eq(userStreaks.userId, userId),
          eq(userStreaks.status, "active"),
          sql`${userStreaks.freezeTokens} >= ${missed}`,
          // Conditional write: only spend if the row is STILL behind. Guards a
          // TOCTOU race where evaluateStreaks/tryAdvance commits a newer
          // last_period_end between our SELECT and this UPDATE — without it we
          // would overwrite that advance with the older lastCompletedEnd and
          // silently regress the streak (Inspector finding).
          sql`${userStreaks.lastPeriodEnd} < ${lastCompletedEnd}`,
        ),
      )
      .returning();
    return rows[0] ?? null;
  }
}
