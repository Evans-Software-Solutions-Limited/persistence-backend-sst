import { and, desc, eq, gte, sql } from "drizzle-orm";
import {
  habitCompletions,
  profiles,
  userGoals,
  type HabitCompletion,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";
import { localDateISO } from "../streaks/period";

/**
 * Habit-completion reads + writes (06-progress-goals, Phase 06.3).
 * Backs the habit_streak source (cross-cuts § 3.3) and the Home habits grid
 * (STORY-004). Every method is JWT-scoped by `userId`.
 *
 * Dedup grain is the USER-LOCAL day (`local_completed_date`), computed from
 * profiles.timezone — NOT a UTC day. A UTC-day bucket dropped a real
 * completion for any non-UTC user whose two local days straddle UTC midnight
 * (Inspector finding, PR #116); the streak engine reads the same local-day
 * grain, so the two layers now agree.
 */
export class HabitRepository {
  static readonly key = "HabitRepository";

  /** The user-local calendar date (YYYY-MM-DD) of `at`, per profiles.timezone. */
  private async localDate(userId: string, at: Date): Promise<string> {
    const db = getDb();
    const rows = await db
      .select({ tz: profiles.timezone })
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);
    return localDateISO(at, rows[0]?.tz ?? "Europe/London");
  }

  /**
   * Whether `goalId` belongs to `userId`. The habit-completion insert's FK
   * only proves the goal EXISTS — without this check any authenticated user
   * could log completions against another user's goal UUID (Inspector
   * finding, PR #116; violates the repo's ownership rule).
   */
  async goalBelongsToUser(userId: string, goalId: string): Promise<boolean> {
    const db = getDb();
    const rows = await db
      .select({ id: userGoals.id })
      .from(userGoals)
      .where(and(eq(userGoals.id, goalId), eq(userGoals.userId, userId)))
      .limit(1);
    return rows.length > 0;
  }

  /**
   * Mark a habit complete for a user-local day. Idempotent: the unique index
   * on (user_id, goal_id, local_completed_date) makes a same-local-day
   * re-toggle a no-op via ON CONFLICT DO NOTHING. Returns the existing or new
   * row.
   *
   * `localDate` (YYYY-MM-DD), when supplied, is AUTHORITATIVE for the dedup
   * day — the handler passes it through for date-only client input, where the
   * tapped grid cell IS the user-local day and converting via an instant would
   * shift it a day for any user west of UTC (Inspector finding, PR #116).
   * Without it, the day is derived from `completedAt` + profiles.timezone.
   */
  async create(
    userId: string,
    data: {
      goalId: string;
      completedAt: Date;
      localDate?: string;
      value?: number | null;
    },
  ): Promise<HabitCompletion> {
    const db = getDb();
    const localCompletedDate =
      data.localDate ?? (await this.localDate(userId, data.completedAt));

    const inserted = await db
      .insert(habitCompletions)
      .values({
        userId,
        goalId: data.goalId,
        completedAt: data.completedAt,
        localCompletedDate,
        value: data.value != null ? String(data.value) : null,
      })
      .onConflictDoNothing()
      .returning();

    if (inserted[0]) return inserted[0];

    // Conflict (already completed that local day) — return the existing row.
    const existing = await db
      .select()
      .from(habitCompletions)
      .where(
        and(
          eq(habitCompletions.userId, userId),
          eq(habitCompletions.goalId, data.goalId),
          eq(habitCompletions.localCompletedDate, localCompletedDate),
        ),
      )
      .limit(1);
    return existing[0];
  }

  /**
   * Remove the completion for a user-local day (toggle-off). Returns the
   * deleted row's local day, or null when nothing matched. `localDate` is
   * authoritative when supplied (same date-only contract as `create`). The
   * HANDLER owns the conditional streak rollback via
   * StreakRepository.rollbackHabitAdvance — the old comment claiming "the
   * nightly cron reconciles" was wrong: the cron never re-checks satisfaction
   * for periods at/behind last_period_end (Inspector finding, PR #116).
   */
  async remove(
    userId: string,
    goalId: string,
    completedAt: Date,
    localDate?: string,
  ): Promise<string | null> {
    const db = getDb();
    const localCompletedDate =
      localDate ?? (await this.localDate(userId, completedAt));
    const deleted = await db
      .delete(habitCompletions)
      .where(
        and(
          eq(habitCompletions.userId, userId),
          eq(habitCompletions.goalId, goalId),
          eq(habitCompletions.localCompletedDate, localCompletedDate),
        ),
      )
      .returning({ id: habitCompletions.id });
    return deleted.length > 0 ? localCompletedDate : null;
  }

  /**
   * List completions within the last `windowDays`, newest-first, optionally
   * restricted to one goal. Feeds the 7-day Home habits grid.
   */
  async list(
    userId: string,
    options: { goalId?: string; windowDays?: number } = {},
  ): Promise<HabitCompletion[]> {
    const db = getDb();
    const windowDays = options.windowDays ?? 7;

    const clauses = [
      eq(habitCompletions.userId, userId),
      gte(
        habitCompletions.completedAt,
        sql`now() - make_interval(days => ${windowDays})`,
      ),
    ];
    if (options.goalId) {
      clauses.push(eq(habitCompletions.goalId, options.goalId));
    }

    return db
      .select()
      .from(habitCompletions)
      .where(and(...clauses))
      .orderBy(desc(habitCompletions.completedAt));
  }
}
