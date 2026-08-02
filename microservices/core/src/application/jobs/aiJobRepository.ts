import { and, eq, lt, sql } from "drizzle-orm";
import { aiJobs, type AiJob } from "@persistence/db";
import { getDb } from "@persistence/db/client";
import type { JobError, JobStatus } from "./types";

const PG_UNIQUE_VIOLATION = "23505";

/** Index names, so a 23505 can be attributed rather than guessed at. */
export const IDEMPOTENCY_INDEX = "ai_jobs_user_kind_client_request_idx";
export const INFLIGHT_INDEX = "ai_jobs_one_inflight_per_kind_idx";

/**
 * How long a `running` job may be silent before ANOTHER worker may take it over
 * (design § 3.1).
 *
 * This is the fence that makes re-claiming a `running` job safe. Without it, a
 * duplicate delivery could claim a job that is *actively running* and execute
 * the same steps concurrently — two workers interleaving checkpoint writes, with
 * `progress_done` able to go backwards.
 *
 * 5 minutes is far longer than any step should take between heartbeats (the
 * spine writes one after every step, and a kind with a longer step must call the
 * `heartbeat()` its step context provides). It is far SHORTER than
 * `STALE_AFTER_MS`, and it has to be: a hard-killed job must become re-claimable
 * long before it is declared dead to the client, or its checkpoint is lost.
 */
export const CLAIM_FENCE_MS = 5 * 60 * 1000;

/**
 * When a job is declared dead to the CLIENT (design § 3.4).
 *
 * ⚠ THIS MUST EXCEED THE QUEUE'S VISIBILITY TIMEOUT PLUS A FULL WORKER RUN, and
 * an earlier revision sized it against the worker timeout alone (15 min) — which
 * was wrong in a way that costs money. A retryable step failure 30 s into an
 * invocation leaves the message invisible for the whole 16-minute visibility
 * timeout while the heartbeat sits at 30 s. At 15 minutes the poll endpoint would
 * report `failed`/`stale` — "Nothing was saved; try again" — during the gap
 * before redelivery, so a client following the documented "stop polling on a
 * terminal status" contract gives up and the user re-runs, double-spending, while
 * the original job is quietly redelivered and succeeds.
 *
 * 40 minutes = 16 min visibility + 15 min worker run + margin. It is a
 * deliberately loose upper bound: the cost of being too high is a client waiting
 * longer on a genuinely dead job; the cost of being too low is duplicate spend
 * and a discarded checkpoint.
 */
export const STALE_AFTER_MS = 40 * 60 * 1000;

/**
 * How long a job may sit `queued` before it is given up on (design § 3.4).
 *
 * A message can die before it is ever claimed: throttled receives count toward
 * the redrive policy, so a burst against the worker's reserved concurrency can
 * send a message to the DLQ having never executed. Nothing about `running`
 * staleness covers that — the row stays `queued` forever, so the client polls it
 * indefinitely AND the terminal-job purge never sees it.
 *
 * Sized off the redrive policy, not the worker: 3 receives × a 16-minute
 * visibility timeout is ~48 minutes to reach the DLQ, so 60 minutes guarantees
 * the message is genuinely gone before the row is written off.
 */
export const QUEUED_STALE_AFTER_MS = 60 * 60 * 1000;

/**
 * The two give-up errors, defined once and shared by the read path (which
 * DERIVES them) and the nightly sweep (which PERSISTS them), so the client never
 * sees the message change when the sweep catches up with the derivation.
 */
export const STALE_RUNNING_ERROR: JobError = {
  code: "stale",
  message:
    "The job stopped reporting progress and was ended. Nothing was saved; try again.",
  retryable: false,
};

export const STALE_QUEUED_ERROR: JobError = {
  code: "stale",
  message: "The job never started and was ended. Nothing was saved; try again.",
  retryable: false,
};

/** Terminal states — a job here will never run again. */
export const TERMINAL_STATUSES: readonly JobStatus[] = [
  "succeeded",
  "failed",
  "cancelled",
];

/**
 * `TERMINAL_STATUSES` as a SQL literal list.
 *
 * Built from the constant rather than hand-spelled at each use site: two sources
 * of truth for "terminal" in one file means a future fourth terminal status gets
 * added to the union and silently missed by the purge.
 */
const TERMINAL_STATUS_SQL = sql.raw(
  TERMINAL_STATUSES.map((s) => `'${s}'`).join(", "),
);

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === PG_UNIQUE_VIOLATION
  );
}

/** Which index a unique violation came from. postgres.js exposes the name. */
function violatedConstraint(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const name = (error as { constraint_name?: unknown }).constraint_name;
  return typeof name === "string" ? name : null;
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
   * There are TWO unique indexes on this table and a 23505 is attributed by
   * NAME rather than assumed:
   *
   *   - the idempotency index → a replay, so return the existing row;
   *   - the in-flight index   → this user already has a job of this kind
   *     running, which is a different answer (`inFlight`, a 409) and must not be
   *     mistaken for a successful replay.
   *
   * `outcome` tells the caller which happened, so the handler can answer `202`
   * for a new job, `200` for a replay and `409` for a collision.
   */
  async enqueue(input: {
    userId: string;
    kind: string;
    input: unknown;
    total: number;
    clientRequestId?: string | null;
    maxAttempts?: number;
  }): Promise<{
    job: AiJob | null;
    outcome: "created" | "replayed" | "in_flight";
  }> {
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
      return { job, outcome: "created" };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;

      const constraint = violatedConstraint(error);

      // Already running one of these. Reported rather than queued: one unit of
      // work here is up to ~120 inferences, so serialising per user per kind is
      // the cost control the read-then-write daily ceiling cannot be.
      if (constraint === INFLIGHT_INDEX) {
        return { job: null, outcome: "in_flight" };
      }

      // A replay. Only the idempotency index can produce this, and only when a
      // key was supplied — anything else is a bug we must not swallow.
      if (constraint !== IDEMPOTENCY_INDEX || input.clientRequestId == null) {
        throw error;
      }
      // Scoped to exactly the row that collided: the index is
      // (user_id, kind, client_request_id).
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
        // The row vanished between the insert and this read. Swallowing it
        // would return a success with no job — rethrow.
        throw error;
      }
      return { job: existing, outcome: "replayed" };
    }
  }

  /**
   * Delete a job that was never published (AC-1.2).
   *
   * The queue publish is the last step of enqueue, and when it fails the row is
   * DELETED rather than marked failed. Marking it failed looks tidier but
   * creates a trap: the row keeps occupying `(user_id, kind, client_request_id)`,
   * so a client retrying with the same idempotency key — which is exactly what
   * an idempotency key is for — gets `200 replayed` with the same dead job,
   * forever. Deleting frees both the idempotency key and the in-flight slot, so
   * a retry behaves like a first attempt.
   *
   * Scoped to `queued` with no heartbeat, i.e. provably never claimed, so this
   * can never race a worker that has already picked the job up.
   */
  async deleteUnpublished(jobId: string): Promise<void> {
    const db = getDb();
    await db
      .delete(aiJobs)
      .where(
        and(
          eq(aiJobs.id, jobId),
          eq(aiJobs.status, "queued"),
          sql`${aiJobs.heartbeatAt} IS NULL`,
        ),
      );
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
   * ## The status gate is FENCED, and the fence is the whole point
   *
   * `'queued'` is the ordinary case: a fresh job, and also a job that yielded at
   * its time budget — the yield sets the status BACK to `queued` precisely so
   * resuming needs no special case.
   *
   * `'running'` is claimable ONLY when the heartbeat has gone cold by
   * `CLAIM_FENCE_MS`. An earlier revision allowed any `running` job, which
   * quietly broke the exactly-once claim it was documented as providing: a
   * duplicate delivery arriving while a worker was mid-run would claim the job
   * and execute the same steps concurrently, two workers interleaving checkpoint
   * writes with `progress_done` able to move backwards. The fence keeps the only
   * legitimate takeover — a worker that died without writing a terminal state, and
   * a hard-kill runs no `finally` — while making concurrent execution impossible.
   *
   * ## Two independent bounds, both inside the same statement
   *
   * `attempts < max_attempts` bounds CONSECUTIVE STALLS (the counter is reset on
   * any completed step), and `invocations < max_invocations` bounds total claims.
   * Both live here so they hold even if SQS's redrive policy is misconfigured:
   * SQS bounds DELIVERIES, these bound EXECUTIONS.
   *
   * Returns `null` when the job must not run.
   */
  async claim(jobId: string): Promise<AiJob | null> {
    const db = getDb();
    const fenceCutoff = new Date(Date.now() - CLAIM_FENCE_MS);
    const rows = await db
      .update(aiJobs)
      .set({
        status: "running",
        attempts: sql`${aiJobs.attempts} + 1`,
        invocations: sql`${aiJobs.invocations} + 1`,
        // COALESCE so a resumed job keeps the time it FIRST started, which is
        // what the user has been waiting since.
        startedAt: sql`COALESCE(${aiJobs.startedAt}, now())`,
        heartbeatAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(aiJobs.id, jobId),
          sql`(
            ${aiJobs.status} = 'queued'
            OR (
              ${aiJobs.status} = 'running'
              AND (
                ${aiJobs.heartbeatAt} IS NULL
                OR ${aiJobs.heartbeatAt} < ${fenceCutoff}
              )
            )
          )`,
          sql`${aiJobs.attempts} < ${aiJobs.maxAttempts}`,
          sql`${aiJobs.invocations} < ${aiJobs.maxInvocations}`,
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
   *
   * ⚠ `attempts` is RESET TO ZERO here, and that is what makes it a stall budget
   * rather than an invocation budget. Progress means the job is healthy, so the
   * retry allowance should start again — otherwise a long job that legitimately
   * needs several invocations spends its whole allowance on yields and dies
   * mid-progress on the first transient Bedrock throttle, discarding paid work.
   * `invocations` is the counter that does NOT reset, and it is the absolute
   * bound.
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
        attempts: 0,
        heartbeatAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(aiJobs.id, input.jobId));
  }

  /**
   * Hand the job back to the queue at the time budget (design § 3.3).
   *
   * Sets the status back to `queued`, which is what lets `claim`'s fence be
   * strict about `running`: a yielded job needs no takeover window because it has
   * explicitly released itself. Scoped to `running` so a job finalised by another
   * path is not resurrected into the queue.
   */
  async releaseForResume(jobId: string): Promise<void> {
    const db = getDb();
    await db
      .update(aiJobs)
      .set({ status: "queued", updatedAt: sql`now()` })
      .where(and(eq(aiJobs.id, jobId), eq(aiJobs.status, "running")));
  }

  /**
   * Liveness only — for a kind whose single step runs longer than
   * `CLAIM_FENCE_MS`. Reachable from a kind via `JobStepContext.heartbeat`; a
   * kind that never calls it is fine as long as its steps are shorter than the
   * fence.
   */
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
    const rows = await db
      .update(aiJobs)
      .set({
        status: "failed",
        error: STALE_RUNNING_ERROR,
        finishedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(aiJobs.status, "running"),
          // ⚠ `OR heartbeat_at IS NULL` matters: `lt()` evaluates to NULL for a
          // NULL heartbeat, so such a row would never match — while
          // `isStaleRunning` on the read path already reports it stale. Without
          // this the two halves of the staleness contract disagree and the row
          // is derived-failed forever but never terminal, so it can never be
          // purged either. `claim` always sets a heartbeat, so this is
          // defence-in-depth rather than a live bug.
          sql`(${aiJobs.heartbeatAt} IS NULL OR ${aiJobs.heartbeatAt} < ${cutoff})`,
        ),
      )
      .returning({ id: aiJobs.id });
    return rows.length;
  }

  /**
   * Persist the terminal state of jobs that were never claimed at all
   * (design § 3.4).
   *
   * `markStaleRunning` cannot cover this: a message that dies before its first
   * receive leaves the row `queued`, and nothing about `running` staleness
   * applies. Throttled receives count toward the redrive policy, so a burst
   * against the worker's reserved concurrency really can send a message to the
   * DLQ having never executed — leaving a client polling `queued 0/120` forever
   * and a row the terminal-job purge never sees.
   */
  async markStaleQueued(now: Date = new Date()): Promise<number> {
    const db = getDb();
    const cutoff = new Date(now.getTime() - QUEUED_STALE_AFTER_MS);
    const rows = await db
      .update(aiJobs)
      .set({
        status: "failed",
        error: STALE_QUEUED_ERROR,
        finishedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(and(eq(aiJobs.status, "queued"), lt(aiJobs.createdAt, cutoff)))
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
          // Rendered from TERMINAL_STATUSES rather than hand-spelled, so a
          // future fourth terminal status cannot be added to the union and
          // silently missed here.
          sql`${aiJobs.status} IN (${TERMINAL_STATUS_SQL})`,
          lt(aiJobs.finishedAt, cutoff),
        ),
      )
      .returning({ id: aiJobs.id });
    return rows.length;
  }
}
