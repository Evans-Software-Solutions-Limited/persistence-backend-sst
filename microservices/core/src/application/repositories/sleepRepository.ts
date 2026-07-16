import { and, desc, eq, sql } from "drizzle-orm";
import { sleepData, type SleepData } from "@persistence/db";
import { getDb } from "@persistence/db/client";

export interface UpsertManualSleepInput {
  sleepDate: string;
  durationMinutes: number;
  sleepStart?: Date;
  sleepEnd?: Date;
}

export class SleepRepository {
  static readonly key = "SleepRepository";

  /**
   * Upsert the caller's manual sleep row for `sleepDate` (specs/20-sleep-
   * quicklog STORY-002 AC 2.1/2.4). `data_source` is the concrete literal
   * `'manual'`, so `ON CONFLICT (user_id, sleep_date, data_source)` matches
   * the existing `sleep_data_user_date_source_idx` unique index and enforces
   * exactly one manual row per user per day (AC 1.4) — re-saving the same
   * day overwrites, never duplicates.
   *
   * `created_at` is bumped to `now()` on every save (insert AND update) so a
   * fresh manual entry always sorts as the most-recent row for the day —
   * `getForDate`'s Decision-D3 "most-recent by created_at" precedence relies
   * on this to make a fresh manual save immediately win over a stale device
   * sync from earlier in the day.
   */
  async upsertManual(
    userId: string,
    input: UpsertManualSleepInput,
  ): Promise<SleepData> {
    const db = getDb();
    const result = await db
      .insert(sleepData)
      .values({
        userId,
        sleepDate: input.sleepDate,
        durationMinutes: input.durationMinutes,
        sleepStart: input.sleepStart ?? null,
        sleepEnd: input.sleepEnd ?? null,
        dataSource: "manual",
      })
      .onConflictDoUpdate({
        target: [sleepData.userId, sleepData.sleepDate, sleepData.dataSource],
        set: {
          durationMinutes: input.durationMinutes,
          sleepStart: input.sleepStart ?? null,
          sleepEnd: input.sleepEnd ?? null,
          createdAt: sql`now()`,
        },
      })
      .returning();

    return result[0];
  }

  /**
   * The caller's most-authoritative sleep record for `sleepDate` (Decision
   * D3): most-recent by `created_at`, across ANY `data_source` — a manual
   * row and a device-synced row can coexist as separate tuples for the same
   * day (the unique index is per-source), and the newer one wins. Every
   * query is scoped by `userId` (DANGEROUS AREA — no cross-user reads).
   */
  async getForDate(
    userId: string,
    sleepDate: string,
  ): Promise<SleepData | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(sleepData)
      .where(
        and(eq(sleepData.userId, userId), eq(sleepData.sleepDate, sleepDate)),
      )
      .orderBy(desc(sleepData.createdAt))
      .limit(1);

    return rows[0] ?? null;
  }
}
