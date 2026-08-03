import type { AiJob } from "@persistence/db";
import { AiJobRepository } from "./aiJobRepository";
import { getJobKind } from "./registry";
import { sqsJobQueue, type JobQueue } from "./jobQueue";
import { AiUnavailableError } from "../nutrition/services/aiBedrockClient";
import { JobKindError, type JobError, type JobErrorCode } from "./types";
import { isLive, isOutOfBudget, isWarmRunning } from "./jobLifecycle";

/**
 * Wall-clock the worker keeps in hand for the final checkpoint + re-enqueue
 * after it decides to stop (design § 3.3).
 *
 * ⚠ A Lambda hard-kill runs no `finally`, so there is no cleanup path that
 * could rescue an over-run. The reserve is what makes stopping a WRITE BEFORE
 * the deadline rather than cleanup after it — the same failure `infra/api.ts`
 * documents for the equipment scan at SST's 20 s default, where a hard-kill
 * meant no `ai_usage_log` row for an inference Bedrock had already billed.
 */
export const CHECKPOINT_RESERVE_MS = 15_000;

/**
 * Multiplier on the slowest step observed SO FAR in this invocation.
 *
 * A rolling max, not a constant: a kind's steps vary (a 3-exercise workout
 * against a 12-exercise one), so a fixed estimate either reserves far too much
 * — abandoning a run with minutes of usable budget left — or under-reserves and
 * gets hard-killed. 1.5× absorbs an unusually slow tail step.
 */
export const STEP_SAFETY_FACTOR = 1.5;

/** First step of an invocation has nothing observed yet. Assume a slow one. */
export const INITIAL_STEP_ESTIMATE_MS = 20_000;

export interface RunJobOutcome {
  jobId: string;
  status: "succeeded" | "failed" | "yielded" | "skipped";
  stepsRun: number;
  progress: number;
  total: number;
  code?: JobErrorCode;
}

function classifyError(error: unknown): JobError {
  if (error instanceof JobKindError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    };
  }
  if (error instanceof AiUnavailableError) {
    return {
      code: "ai_unavailable",
      message: "The AI service is temporarily unavailable.",
      retryable: true,
    };
  }
  // Fail-safe toward RETRYING: an unrecognised throw is more likely a transient
  // blip than a permanent rejection, and the `attempts` bound stops a genuinely
  // broken job from retrying forever regardless.
  return {
    code: "step_failed",
    message: error instanceof Error ? error.message : String(error),
    retryable: true,
  };
}

/**
 * Execute one claimed job as far as this invocation's time budget allows.
 * `specs/_shared/async-jobs/design.md` § 3.
 *
 * Separated from the Lambda entry point so the whole execution contract —
 * claim, resume, checkpoint, yield, terminal states — is testable without an
 * SQS event or a Lambda context.
 *
 * `remainingMs` is injected rather than read from a Lambda context here, both
 * so tests can drive the time budget deterministically and so this file has no
 * dependency on the runtime it happens to be hosted by.
 */
export async function runJob(input: {
  jobId: string;
  remainingMs: () => number;
  repository?: AiJobRepository;
  queue?: JobQueue;
  now?: () => number;
}): Promise<RunJobOutcome> {
  const jobs = input.repository ?? new AiJobRepository();
  const queue = input.queue ?? sqsJobQueue;
  const now = input.now ?? (() => Date.now());

  // ⚠ THE CLAIM (§ 3.1). Zero rows means "do not run", and that single
  // condition covers every duplicate-execution path: an SQS duplicate delivery,
  // a Lambda retry, a redelivery after the visibility timeout expired, and a
  // DLQ replay of a job that already succeeded. Skipping is a SUCCESS for the
  // worker — the message gets deleted, which is exactly what should happen to a
  // duplicate.
  const claimed: AiJob | null = await jobs.claim(input.jobId);
  if (!claimed) {
    // Four situations produce a refused claim, and ⚠ THE ORDER OF THESE CHECKS IS
    // LOAD-BEARING. Returning normally DELETES the SQS message; throwing keeps it
    // for redelivery. Getting either wrong loses a job.
    const existing = await jobs.get(input.jobId);

    //  (a) gone, or already terminal — an ordinary duplicate delivery. Nothing to
    //      do, and deleting the message is exactly right.
    if (!existing || !isLive(existing)) {
      return {
        jobId: input.jobId,
        status: "skipped",
        stepsRun: 0,
        progress: existing?.progressDone ?? 0,
        total: existing?.progressTotal ?? 0,
      };
    }

    //  (b) `running` with a WARM heartbeat — another worker holds it RIGHT NOW.
    //
    //      ⚠ Checked BEFORE the budget test, and that ordering is the fix for a
    //      real bug: on its last allowed claim the holder has already consumed the
    //      whole budget, so a budget-first check would mark the job
    //      `attempts_exhausted` while the holder is still spending Bedrock —
    //      `succeed()` is scoped to `running`, so the finished result would then
    //      be thrown away and the user told the job failed repeatedly.
    //
    //      Throw rather than return: this delivery has no work to do, but the
    //      message must survive so that if the holder dies, a later redelivery can
    //      take the job over once the heartbeat goes cold. Returning here is what
    //      ORPHANS a job — see (c).
    if (isWarmRunning(existing)) {
      throw new JobKindError(
        "step_failed",
        `job ${existing.id} is held by a live worker; retrying later`,
      );
    }

    //  (c) live, cold, and out of budget — genuinely finished trying. SQS can
    //      deliver more times than either bound allows executions, and such a job
    //      would otherwise sit un-terminal until a sweep found it. AC-3.4 wants a
    //      terminal state, so give it one now.
    if (isOutOfBudget(existing)) {
      const error: JobError = {
        code: "attempts_exhausted",
        message: "The job failed repeatedly and was given up on.",
        retryable: false,
      };
      await jobs.fail(existing.id, error);
      return {
        jobId: input.jobId,
        status: "failed",
        stepsRun: 0,
        progress: existing.progressDone,
        total: existing.progressTotal,
        code: error.code,
      };
    }

    //  (d) live, in budget, but the claim still lost. Split by status, because the
    //      two sub-cases want opposite answers.
    //
    //      `queued` is provably the aftermath of ANOTHER worker's yield: our claim
    //      can only have lost to a holder, and `releaseForResume` is always
    //      followed by a `send` or by a terminal `fail`. So a replacement message
    //      already exists, and throwing would add a SECOND one — which then
    //      bounces off the real worker for three receives and lands in the DLQ
    //      while the job succeeds, tripping a `threshold: 1` alarm whose text says
    //      a paying user lost a job. Return, and let the existing message do the
    //      work.
    if (existing.status === "queued") {
      return {
        jobId: input.jobId,
        status: "skipped",
        stepsRun: 0,
        progress: existing.progressDone,
        total: existing.progressTotal,
      };
    }

    //      `running` and cold is a genuine race (someone claimed it between our
    //      UPDATE and this read). ⚠ THROW. An earlier revision returned `skipped`
    //      for every refusal, which DELETED the message — and that orphaned jobs on
    //      a path this spine exists to protect. Throwing hands it back to SQS; the
    //      redrive policy bounds the loop.
    throw new JobKindError(
      "step_failed",
      `job ${existing.id} was not claimable yet; retrying later`,
    );
  }

  const kind = getJobKind(claimed.kind);
  if (!kind) {
    // Deploy skew: enqueued by a newer API Lambda, picked up by an older
    // worker. Terminal, not retryable — redelivering a job no deployed worker
    // understands only burns invocations on the way to the DLQ.
    const error: JobError = {
      code: "unknown_kind",
      message: `No handler is registered for job kind "${claimed.kind}".`,
      retryable: false,
    };
    await jobs.fail(claimed.id, error);
    return {
      jobId: claimed.id,
      status: "failed",
      stepsRun: 0,
      progress: claimed.progressDone,
      total: claimed.progressTotal,
      code: error.code,
    };
  }

  const total = claimed.progressTotal;
  // Resume point. The checkpoint is written with `progressDone` in the SAME
  // statement, so the two can never disagree and a resume never skips work it
  // did not do.
  let done = claimed.progressDone;
  let checkpoint = claimed.checkpoint ?? null;
  let stepsRun = 0;
  let slowestStepMs = 0;
  // ⚠ MIRRORS THE DB COUNTER, and must be reset wherever `checkpoint()` resets it.
  //
  // `claimed.attempts` is the value read AT CLAIM TIME and never refreshed, while
  // `jobs.checkpoint()` sets `attempts = 0` on every completed step. Testing the
  // claim-time value would therefore test a counter the loop has already
  // invalidated — and the consequence is a money loss, not an inelegance: a job
  // that stalled twice and then completed 40 steps in its third invocation would
  // be failed TERMINALLY by the next transient Bedrock 429, discarding ~$0.23 of
  // purchased inference, exactly the outcome the reset exists to prevent.
  let attemptsSinceProgress = claimed.attempts;

  while (done < total) {
    const estimate =
      slowestStepMs > 0
        ? slowestStepMs * STEP_SAFETY_FACTOR
        : INITIAL_STEP_ESTIMATE_MS;

    if (input.remainingMs() < estimate + CHECKPOINT_RESERVE_MS) {
      // YIELD (§ 3.3). Stop before the kill and hand the rest to a fresh
      // invocation.
      //
      // ⚠ RELEASE FIRST, then publish. Setting the status back to `queued` is
      // what lets `claim`'s fence be strict about `running` — a yielded job has
      // explicitly released itself, so it needs no takeover window and no
      // duplicate-execution risk. Doing it in the other order would leave a
      // window where the new message is claimable only via the fence.
      //
      // The ordering also fails SAFE: if the publish then fails, the job is
      // `queued` and the queued-stale reaper is the backstop even if the
      // explicit fail below somehow does not land.
      await jobs.releaseForResume(claimed.id);
      try {
        await queue.send({ jobId: claimed.id });
      } catch (error) {
        // Nothing will pick the job back up. Fail it now rather than leave it
        // to be reaped an hour later — the work done so far is already
        // checkpointed and the user gets a real error promptly.
        const failure = classifyError(error);
        await jobs.fail(claimed.id, failure);
        return {
          jobId: claimed.id,
          status: "failed",
          stepsRun,
          progress: done,
          total,
          code: failure.code,
        };
      }
      return {
        jobId: claimed.id,
        status: "yielded",
        stepsRun,
        progress: done,
        total,
      };
    }

    const stepStartedAt = now();
    try {
      checkpoint = await kind.runStep({
        jobId: claimed.id,
        userId: claimed.userId,
        input: claimed.input as never,
        checkpoint: checkpoint as never,
        index: done,
        total,
        // For a kind whose single step outlasts `CLAIM_FENCE_MS`. Without this
        // the method existed but was unreachable, so such a kind would be taken
        // over mid-step by another worker.
        heartbeat: () => jobs.heartbeat(claimed.id),
      });
    } catch (error) {
      const failure = classifyError(error);
      // The consecutive-stall counter as of RIGHT NOW — zero if this invocation
      // has completed any step, since `checkpoint()` reset the DB counter too. So
      // a job making progress always has its full retry allowance, WITHIN an
      // invocation as well as across them.
      if (failure.retryable && attemptsSinceProgress < claimed.maxAttempts) {
        // Throwing lets the SQS message become visible again and be redelivered.
        // The job stays `running` with its checkpoint intact, so the retry
        // resumes rather than restarts — the difference between re-buying 30
        // model calls and re-buying 120.
        throw error;
      }
      await jobs.fail(claimed.id, failure);
      return {
        jobId: claimed.id,
        status: "failed",
        stepsRun,
        progress: done,
        total,
        code: failure.code,
      };
    }

    slowestStepMs = Math.max(slowestStepMs, now() - stepStartedAt);
    done += 1;
    stepsRun += 1;
    // Checkpoint after EVERY step, never batched. Batching would lose the whole
    // invocation's progress on a hard-kill, and with it the cost accounting for
    // inference already billed (AC-4.5).
    await jobs.checkpoint({
      jobId: claimed.id,
      checkpoint,
      progressDone: done,
    });
    // Kept in step with the reset `checkpoint()` just performed. Progress means
    // the job is healthy, so the stall allowance starts again.
    attemptsSinceProgress = 0;
  }

  try {
    const result = await kind.finish({
      jobId: claimed.id,
      userId: claimed.userId,
      input: claimed.input as never,
      checkpoint: checkpoint as never,
      total,
    });
    await jobs.succeed(claimed.id, result);
  } catch (error) {
    const failure = classifyError(error);
    await jobs.fail(claimed.id, failure);
    return {
      jobId: claimed.id,
      status: "failed",
      stepsRun,
      progress: done,
      total,
      code: failure.code,
    };
  }

  return {
    jobId: claimed.id,
    status: "succeeded",
    stepsRun,
    progress: done,
    total,
  };
}
