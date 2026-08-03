import { lt } from "drizzle-orm";
import {
  clientDataAccessLog,
  dailyActivityData,
  sleepData,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";
import type {
  DataRetentionCounts,
  DataRetentionRepo,
} from "./dataRetentionSweep";

/**
 * Data access for the nightly retention sweep. See `dataRetentionSweep.ts` for
 * why retention is enforced here rather than by calling the admin-gated
 * `cleanup_old_health_data()` SQL function.
 */
export class DataRetentionRepository implements DataRetentionRepo {
  async pruneOlderThan(cutoff: Date): Promise<DataRetentionCounts> {
    const db = getDb();

    // ⚠ `activity_date` / `sleep_date` are Postgres **DATE** columns
    // (`supabase/migrations/001_initial_schema.sql:629,644`). The Drizzle mirror
    // declares them `text(...)`, and it is the MIRROR that is stale — see the
    // header of `application/health/sleep/sleepDate.ts`, which documents the same
    // discrepancy and a real 22008 runtime symptom from it.
    //
    // So Postgres infers `$1::date` from `date_col < $1` and performs a genuine
    // date comparison. Slicing to 10 chars gives it a bare calendar date to cast,
    // which matches the column's own granularity. Do NOT reason about this as a
    // lexicographic text comparison: the rendered SQL is byte-identical either
    // way, so a `PgDialect` assertion cannot tell you which is happening.
    const cutoffDate = cutoff.toISOString().slice(0, 10);

    // `.returning({ id })` purely to count rows. Deliberate tradeoff: the counts
    // feed the `[data-retention:summary]` log line, which together with the
    // Sentry capture in `accountPurgeCron` is the ONLY way to see that a
    // published retention promise is still being kept. The cost is materialising
    // every deleted id in JS, worst on the first run against the never-pruned
    // backlog — mitigated by the supporting index added in
    // `20260803180000_client_data_access_log_created_at_idx.sql`. If this ever
    // strains the Lambda, read the driver's affected-row count instead; no
    // existing delete in this repo does, so it needs verifying against
    // Drizzle-on-postgres.js first rather than being assumed.
    //
    // Sequential rather than `Promise.all`. `getDb()` is a singleton
    // postgres.js pool whose `max` is deliberately small for Lambda, and
    // concurrent multi-row statements on it have deadlocked before (see
    // `reference_postgresjs_max1_concurrency_deadlock`). A nightly sweep has no
    // latency budget worth that risk.
    const activity = await db
      .delete(dailyActivityData)
      .where(lt(dailyActivityData.activityDate, cutoffDate))
      .returning({ id: dailyActivityData.id });

    const sleep = await db
      .delete(sleepData)
      .where(lt(sleepData.sleepDate, cutoffDate))
      .returning({ id: sleepData.id });

    // `created_at` here IS a real timestamptz, so compare against the Date.
    const accessLog = await db
      .delete(clientDataAccessLog)
      .where(lt(clientDataAccessLog.createdAt, cutoff))
      .returning({ id: clientDataAccessLog.id });

    return {
      dailyActivity: activity.length,
      sleep: sleep.length,
      clientDataAccessLog: accessLog.length,
    };
  }
}
