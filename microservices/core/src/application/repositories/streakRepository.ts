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
  compareISO,
  lastCompletedPeriodEndISO,
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
          eq(userStreaks.status, "active"),
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
      // ≥ 1 completion for the source goal in the window.
      const rows = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(habitCompletions)
        .where(
          and(
            eq(habitCompletions.userId, streak.userId),
            streak.sourceGoalId
              ? eq(habitCompletions.goalId, streak.sourceGoalId)
              : sql`true`,
            sql`(${habitCompletions.completedAt} AT TIME ZONE ${tz})::date BETWEEN ${startDate} AND ${endDate}`,
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

  async persistFreezeSpend(
    streakId: string,
    fields: { freezeTokens: number; lastPeriodEnd: string },
  ): Promise<UserStreak> {
    const db = getDb();
    const rows = await db
      .update(userStreaks)
      .set({
        freezeTokens: fields.freezeTokens,
        lastPeriodEnd: fields.lastPeriodEnd,
        status: "active",
        updatedAt: new Date(),
      })
      .where(eq(userStreaks.id, streakId))
      .returning();
    return rows[0];
  }

  async persistBreak(
    streakId: string,
    fields: { lastPeriodEnd: string },
  ): Promise<UserStreak> {
    const db = getDb();
    const rows = await db
      .update(userStreaks)
      .set({
        status: "broken",
        currentCount: 0,
        lastPeriodEnd: fields.lastPeriodEnd,
        updatedAt: new Date(),
      })
      .where(eq(userStreaks.id, streakId))
      .returning();
    return rows[0];
  }

  /**
   * Manual freeze-token spend (06.5 — the You/Progress "Use" button). Spends one
   * token to PROTECT a behind streak: it both decrements `freeze_tokens` AND
   * fast-forwards `last_period_end` to the last completed user-local period
   * (mirroring the cron's `persistFreezeSpend`). Without the `last_period_end`
   * advance the nightly cron would re-detect the same miss and break the streak
   * with 0 tokens left — making the button strictly worse than doing nothing
   * (Inspector finding, PR #116).
   *
   * Returns null (→ handler 400) when: the streak isn't owned by `userId`, is
   * not `active` (a broken/paused streak keeps its leftover tokens, but reviving
   * it would just mint a zombie active/count=0 streak), has no token to spend,
   * OR isn't actually behind (spending then would waste a token the cron would
   * otherwise auto-apply on a real miss).
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
    if (!streak || streak.freezeTokens <= 0) return null;

    const tz = await this.getUserTimezone(userId);
    const lastCompletedEnd = lastCompletedPeriodEndISO(
      now,
      streak.period as Period,
      tz,
    );
    // Not behind → nothing to protect; don't waste the token.
    if (compareISO(streak.lastPeriodEnd, lastCompletedEnd) >= 0) return null;

    const rows = await db
      .update(userStreaks)
      .set({
        freezeTokens: sql`${userStreaks.freezeTokens} - 1`,
        lastPeriodEnd: lastCompletedEnd,
        status: "active",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(userStreaks.id, streakId),
          eq(userStreaks.userId, userId),
          eq(userStreaks.status, "active"),
          sql`${userStreaks.freezeTokens} > 0`,
          // Conditional write: only spend if the row is STILL behind. Guards a
          // TOCTOU race where evaluateStreaks/tryAdvance commits a newer
          // last_period_end between our SELECT and this UPDATE — without it we
          // would overwrite that advance with the older lastCompletedEnd and
          // silently regress the streak by a period (Inspector finding).
          sql`${userStreaks.lastPeriodEnd} < ${lastCompletedEnd}`,
        ),
      )
      .returning();
    return rows[0] ?? null;
  }
}
