import { and, desc, eq, gte, sql } from "drizzle-orm";
import {
  habitCompletions,
  type HabitCompletion,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";

/**
 * Habit-completion reads + writes (06-progress-goals, Phase 06.3).
 * Backs the habit_streak source (cross-cuts § 3.3) and the Home habits grid
 * (STORY-004). Every method is JWT-scoped by `userId`.
 */
export class HabitRepository {
  static readonly key = "HabitRepository";

  /**
   * Mark a habit complete for a user-local day. Idempotent: the unique
   * expression index on (user_id, goal_id, UTC-day) makes a same-day re-toggle
   * a no-op via ON CONFLICT DO NOTHING. Returns the existing or new row.
   */
  async create(
    userId: string,
    data: { goalId: string; completedAt: Date; value?: number | null },
  ): Promise<HabitCompletion> {
    const db = getDb();
    const inserted = await db
      .insert(habitCompletions)
      .values({
        userId,
        goalId: data.goalId,
        completedAt: data.completedAt,
        value: data.value != null ? String(data.value) : null,
      })
      .onConflictDoNothing()
      .returning();

    if (inserted[0]) return inserted[0];

    // Conflict (already completed that UTC day) — return the existing row.
    const existing = await db
      .select()
      .from(habitCompletions)
      .where(
        and(
          eq(habitCompletions.userId, userId),
          eq(habitCompletions.goalId, data.goalId),
          sql`date_trunc('day', ${habitCompletions.completedAt} AT TIME ZONE 'UTC') = date_trunc('day', ${data.completedAt.toISOString()}::timestamptz AT TIME ZONE 'UTC')`,
        ),
      )
      .limit(1);
    return existing[0];
  }

  /**
   * Remove the completion for a user-local day (toggle-off). Returns true if a
   * row was deleted. Note: streak reversal is left to the nightly cron's
   * reconcile (server-wins per design.md § Offline behaviour) — the engine is
   * advance-only on-write.
   */
  async remove(
    userId: string,
    goalId: string,
    completedAt: Date,
  ): Promise<boolean> {
    const db = getDb();
    const deleted = await db
      .delete(habitCompletions)
      .where(
        and(
          eq(habitCompletions.userId, userId),
          eq(habitCompletions.goalId, goalId),
          sql`date_trunc('day', ${habitCompletions.completedAt} AT TIME ZONE 'UTC') = date_trunc('day', ${completedAt.toISOString()}::timestamptz AT TIME ZONE 'UTC')`,
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
