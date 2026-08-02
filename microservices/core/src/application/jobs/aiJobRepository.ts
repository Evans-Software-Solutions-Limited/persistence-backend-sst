import { and, eq, lt, sql } from "drizzle-orm";
import { aiJobs, type AiJob } from "@persistence/db";
import { getDb } from "@persistence/db/client";
import type { JobError, JobStatus } from "./types";

const PG_UNIQUE_VIOLATION = "23505";

/**
 * A `running` job whose heartbeat is older than this is dead — hard-killed,
 * OOM'd, or deployed over (design § 3.4).
 *
 * 15 minutes = the worker's own 900 s timeout plus headroom. It must exceed the
 * worker timeout, or a legitimately long-running job gets reaped mid-run and
 * the user loses work they have already paid inference for.
 */
export const STALE_AFTER_MS = 15 * 60 * 1000;

/** Terminal states — a job here will never run again. */
export const TERMINAL_STATUSES: readonly JobStatus[] = [
  "succeeded",
  "failed",
  "cancelled",
];

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === PG_UNIQUE_VIOLATION
  );
}

/**
 * Data access for the shared async-job spine.
 * `specs/_shared/async-jobs/design.md` § 2 / § 3.
 */
export class AiJobRepository {
  static readonly key = "AiJobRepository";

  /**
   * Create a queued job, or return the existing one for a replayed
   * `clientRequestId` (AC-3.2).
   *
   * Replay detection is CATCH-the-violation, never a pre-flight SELECT: two
   * concurrent enqueues of the same key would both see "no existing row" and
   * both insert. Same reasoning as `SavedGymRepository`'s duplicate-name
   * handling, and as `trainersInviteCodeCreateHandler`'s 23505 catch.
   *
   * `created` tells the caller which happened, so the handler can answer `202`
   * for a new job and `200` for a replay.
   */
  async enqueue(input: {
    userId: string;
    kind: string;
    input: unknown;
    total: number;
    clientRequestId?: string | null;
    maxAttempts?: number;
  }): Promise<{ job: AiJob; created: boolean }> {
    const db = getDb();
    const values = {
      userId: input.userId,
      kind: input.kind,
      input: input.input,
      progressTotal: input.total,
      clientRequestId: input.clientRequestId ?? null,
      ...(input.maxAttempts !== undefined
        ? { maxAttempts: input.maxAttempts }
        : {}),
    };

    try {
      const [job] = await db.insert(aiJobs).values(values).returning();
      return { job, created: true };
    } catch (error) {
      if (!isUniqueViolation(error) || input.clientRequestId == null) {
        throw error;
      }
      // The replay. The unique index is (user_id, kind, client_request_id), so
      // this re-read is scoped to exactly the row that collided.
      const [existing] = await db
        .select()
        .from(aiJobs)
        .where(
          and(
            eq(aiJobs.userId, input.userId),
            eq(aiJobs.kind, input.kind),
            eq(aiJobs.clientRequestId, input.clientRequestId),
          ),
        )
        .limit(1);
      if (!existing) {
        // The violation came from somewhere other than the idempotency index,
        // or the row vanished between the insert and this read. Either way,
        // swallowing it would return a success with no job — rethrow.
        throw error;
      }
      return { job: existing, created: false };
    }
  }

  /**
   * CLAIM a job for execution — design § 3.1, AC-3.1.
   *
   * ⚠ ONE conditional UPDATE. This is the single mechanism that makes
   * at-least-once delivery safe, and every duplicate-execution path collapses
   * into it: an SQS duplicate delivery, a Lambda retry, a redelivery after the
   * visibility timeout expired, and a DLQ replay of an already-succeeded job
   * all hit the same `WHERE` and all get zero rows.
   *
   * ⚠ DO NOT split this into a SELECT and an UPDATE. That is a lost-update race
   * between two concurrent workers, and losing it means running a ~$0.69,
   * 120-inference job twice. The whole point of AC-3.1 is that this is atomic.
   *
   * `status IN ('queued','running')` — `running` is deliberate: it is how a job
   * that checkpointed and re-enqueued itself at its time budget (§ 3.3) gets
   * picked back up.
   *
   * `attempts < max_attempts` lives inside the same statement so the execution
   * bound holds even if SQS's redrive policy is misconfigured. SQS bounds
   * DELIVERIES; this bounds EXECUTIONS.
   *
   * Returns `null` when the job must not run.
   */
  async claim(jobId: string): Promise<AiJob | null> {
    const db = getDb();
    const rows = await db
      .update(aiJobs)
      .set({
        status: "running",
        attempts: sql`${aiJobs.attempts} + 1`,
        // COALESCE so a resumed job keeps the time it FIRST started, which is
        // what the user has been waiting since.
        startedAt: sql`COALESCE(${aiJobs.startedAt}, now())`,
        heartbeatAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(aiJobs.id, jobId),
          sql`${aiJobs.status} IN ('queued', 'running')`,
          sql`${aiJobs.attempts} < ${aiJobs.maxAttempts}`,
        ),
      )
      .returning();
    return rows[0] ?? null;
  }

  /**
   * Persist partial work and liveness in one write (design § 3.2).
   *
   * One statement rather than separate checkpoint/progress/heartbeat writes:
   * this runs after every unit of work in a 120-step job, so it is the hot
   * path, and a partial write (progress advanced, checkpoint not) would make a
   * resume skip work it never did.
   */
  async checkpoint(input: {
    jobId: string;
    checkpoint: unknown;
    progressDone: number;
  }): Promise<void> {
    const db = getDb();
    await db
      .update(aiJobs)
      .set({
        checkpoint: input.checkpoint,
        progressDone: input.progressDone,
        heartbeatAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(aiJobs.id, input.jobId));
  }

  /** Liveness only — for a kind whose step is long enough to look dead. */
  async heartbeat(jobId: string): Promise<void> {
    const db = getDb();
    await db
      .update(aiJobs)
      .set({ heartbeatAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(aiJobs.id, jobId));
  }

  /**
   * Mark the job succeeded. Scoped to `status = 'running'` so a job that was
   * cancelled or already finalised is not resurrected by a late worker.
   */
  async succeed(jobId: string, result: unknown): Promise<void> {
    const db = getDb();
    await db
      .update(aiJobs)
      .set({
        status: "succeeded",
        result,
        error: null,
        finishedAt: sql`now()`,
        heartbeatAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(and(eq(aiJobs.id, jobId), eq(aiJobs.status, "running")));
  }

  /**
   * Mark the job failed with a structured error (AC-5.1).
   *
   * NOT scoped to `running`: the enqueue path fails a job that is still
   * `queued` when the queue publish throws (AC-1.2), and the worker fails a job
   * whose claim was refused on attempts.
   */
  async fail(jobId: string, error: JobError): Promise<void> {
    const db = getDb();
    await db
      .update(aiJobs)
      .set({
        status: "failed",
        error,
        finishedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(aiJobs.id, jobId),
          sql`${aiJobs.status} IN ('queued', 'running')`,
        ),
      );
  }

  /**
   * Unscoped read, for the WORKER only.
   *
   * ⚠ Never reachable from a request path — a worker acts on a job id that came
   * off the queue, not off a caller, so there is no user to scope to. Request
   * handlers use `getForUser`, which cannot return another user's row.
   */
  async get(jobId: string): Promise<AiJob | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(aiJobs)
      .where(eq(aiJobs.id, jobId))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Owner-scoped read for `GET /jobs/:id` (AC-2.2).
   *
   * The `userId` predicate is IN THE QUERY, not a post-read comparison — the
   * repository must be unable to return another user's job at all. A miss is a
   * miss whether the job does not exist or belongs to someone else; the handler
   * answers `404` either way, so a caller learns nothing from probing ids.
   */
  async getForUser(jobId: string, userId: string): Promise<AiJob | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(aiJobs)
      .where(and(eq(aiJobs.id, jobId), eq(aiJobs.userId, userId)))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Persist the terminal state of jobs whose worker died (design § 3.4).
   *
   * The poll endpoint DERIVES staleness on read so a client is never wedged
   * even if this sweep is broken or unscheduled; this exists so the row stops
   * being re-derived and becomes purgeable. Returns the number reaped, for the
   * cron's summary line.
   */
  async markStaleRunning(now: Date = new Date()): Promise<number> {
    const db = getDb();
    const cutoff = new Date(now.getTime() - STALE_AFTER_MS);
    const staleError: JobError = {
      code: "stale",
      message:
        "The job stopped reporting progress and was ended. Nothing was saved; try again.",
      retryable: false,
    };
    const rows = await db
      .update(aiJobs)
      .set({
        status: "failed",
        error: staleError,
        finishedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(and(eq(aiJobs.status, "running"), lt(aiJobs.heartbeatAt, cutoff)))
      .returning({ id: aiJobs.id });
    return rows.length;
  }

  /**
   * Delete terminal jobs finished before `cutoff`. A job row holds a whole
   * generated programme, so this table is not safe to leave growing.
   */
  async purgeTerminalOlderThan(cutoff: Date): Promise<number> {
    const db = getDb();
    const rows = await db
      .delete(aiJobs)
      .where(
        and(
          sql`${aiJobs.status} IN ('succeeded', 'failed', 'cancelled')`,
          lt(aiJobs.finishedAt, cutoff),
        ),
      )
      .returning({ id: aiJobs.id });
    return rows.length;
  }
}
