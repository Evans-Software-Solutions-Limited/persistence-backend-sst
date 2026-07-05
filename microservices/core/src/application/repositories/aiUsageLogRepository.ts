import { and, count, eq, gte } from "drizzle-orm";
import { aiUsageLog } from "@persistence/db";
import { getDb } from "@persistence/db/client";

/**
 * Best-effort telemetry writer for `ai_usage_log` (cross-cuts § 4.2 /
 * `13-nutrition-tracking/design.md § Revised 2026-07-03`). Every AI
 * inference call — success or failure — writes one row here so cost can
 * be modelled per active user and a future quota tier can throttle
 * without a schema change.
 *
 * Deliberately NOT transactional with anything else. Unlike the trainer
 * on-behalf audit log (cross-cuts § 1.4.2, which rolls the row write back
 * if the audit insert fails), a usage-log write failure here must never
 * fail the user-facing response — callers wrap `record()` in their own
 * try/catch inside a `finally` block and swallow errors after logging.
 */
export class AiUsageLogRepository {
  static readonly key = "AiUsageLogRepository";

  async record(input: {
    userId: string;
    endpoint: string;
    requestSizeBytes: number | null;
    responseSizeBytes: number | null;
    ms: number | null;
  }): Promise<void> {
    const db = getDb();
    await db.insert(aiUsageLog).values({
      userId: input.userId,
      endpoint: input.endpoint,
      requestSizeBytes: input.requestSizeBytes,
      responseSizeBytes: input.responseSizeBytes,
      ms: input.ms,
    });
  }

  /**
   * Inference calls this user has made to `endpoint` since UTC midnight —
   * the daily-ceiling counter (cross-cuts § 4.3 Revised 2026-07-05).
   * UTC day boundary (not user-local): this is a cost backstop, not a
   * user-facing quota, so a fixed cheap boundary beats a per-user
   * timezone join. Rejected (429) attempts are never `record()`ed, so
   * the count reflects actual paid inferences only.
   */
  async countForUserToday(userId: string, endpoint: string): Promise<number> {
    const db = getDb();
    const utcMidnight = new Date();
    utcMidnight.setUTCHours(0, 0, 0, 0);
    const rows = await db
      .select({ n: count() })
      .from(aiUsageLog)
      .where(
        and(
          eq(aiUsageLog.userId, userId),
          eq(aiUsageLog.endpoint, endpoint),
          gte(aiUsageLog.createdAt, utcMidnight),
        ),
      );
    return rows[0]?.n ?? 0;
  }
}
