import { and, eq } from "drizzle-orm";
import { waterLog } from "@persistence/db";
import { getDb } from "@persistence/db/client";

export class WaterLogRepository {
  static readonly key = "WaterLogRepository";

  /** Cups logged for a user-local day; 0 when nothing logged yet. */
  async getCups(userId: string, date: string): Promise<number> {
    const db = getDb();
    const rows = await db
      .select({ cups: waterLog.cups })
      .from(waterLog)
      .where(and(eq(waterLog.userId, userId), eq(waterLog.loggedDate, date)))
      .limit(1);
    return rows[0]?.cups ?? 0;
  }

  /**
   * Absolute set (last-write-wins) — the authoritative path the offline sync
   * queue replays idempotently (BACKEND_BRIEF § 4). Clamped to >= 0.
   */
  async setCups(userId: string, date: string, cups: number): Promise<number> {
    const db = getDb();
    const next = Math.max(0, Math.trunc(cups));
    await db
      .insert(waterLog)
      .values({ userId, loggedDate: date, cups: next })
      .onConflictDoUpdate({
        target: [waterLog.userId, waterLog.loggedDate],
        set: { cups: next },
      });
    return next;
  }

  /** Convenience +/- used by the live UI; resolves to an absolute set. */
  async adjust(userId: string, date: string, delta: number): Promise<number> {
    const current = await this.getCups(userId, date);
    return this.setCups(userId, date, current + delta);
  }
}
