import { and, desc, eq, gte, sql } from "drizzle-orm";
import {
  habitCompletions,
  profiles,
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
   * Mark a habit complete for the user-local day of `completedAt`. Idempotent:
   * the unique index on (user_id, goal_id, local_completed_date) makes a
   * same-local-day re-toggle a no-op via ON CONFLICT DO NOTHING. Returns the
   * existing or new row.
   */
  async create(
    userId: string,
    data: { goalId: string; completedAt: Date; value?: number | null },
  ): Promise<HabitCompletion> {
    const db = getDb();
    const localCompletedDate = await this.localDate(userId, data.completedAt);

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
   * Remove the completion for the user-local day of `completedAt` (toggle-off).
   * Returns true if a row was deleted. Streak reversal is left to the nightly
   * cron's reconcile (server-wins per design.md § Offline behaviour) — the
   * engine is advance-only on-write.
   */
  async remove(
    userId: string,
    goalId: string,
    completedAt: Date,
  ): Promise<boolean> {
    const db = getDb();
    const localCompletedDate = await this.localDate(userId, completedAt);
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
    return deleted.length > 0;
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
