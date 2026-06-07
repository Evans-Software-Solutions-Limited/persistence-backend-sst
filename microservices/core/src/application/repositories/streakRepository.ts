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
   * Manual freeze-token spend (06.5 — the You/Progress "Use" button). Decrements
   * one token only when the streak is owned by `userId` AND has a token to
   * spend — ownership + the `freeze_tokens > 0` guard are folded into the WHERE
   * so a cross-user or empty-balance spend simply updates nothing. Returns the
   * updated row, or null when the WHERE matched nothing.
   */
  async spendTokenManually(
    userId: string,
    streakId: string,
  ): Promise<UserStreak | null> {
    const db = getDb();
    const rows = await db
      .update(userStreaks)
      .set({
        freezeTokens: sql`${userStreaks.freezeTokens} - 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(userStreaks.id, streakId),
          eq(userStreaks.userId, userId),
          sql`${userStreaks.freezeTokens} > 0`,
        ),
      )
      .returning();
    return rows[0] ?? null;
  }
}
