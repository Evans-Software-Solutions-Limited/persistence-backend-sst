import type { AiJob } from "@persistence/db";
import { AiJobRepository } from "./aiJobRepository";
import { getJobKind } from "./registry";
import { sqsJobQueue, type JobQueue } from "./jobQueue";
import { AiUnavailableError } from "../nutrition/services/aiBedrockClient";
import { JobKindError, type JobError, type JobErrorCode } from "./types";

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
    // Two very different situations produce a refused claim, and only one of
    // them is benign.
    //
    // The benign one — already terminal, or cancelled — is a duplicate and
    // needs nothing. The other is a job still `queued`/`running` that has burned
    // its attempts: SQS can deliver more times than `max_attempts` allows
    // executions (a visibility-timeout expiry is a redelivery), and such a job
    // would otherwise sit `running` until the staleness sweep found it 15
    // minutes later. AC-3.4 wants a terminal state, so give it one now.
    const existing = await jobs.get(input.jobId);
    if (
      existing &&
      (existing.status === "queued" || existing.status === "running") &&
      existing.attempts >= existing.maxAttempts
    ) {
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
    return {
      jobId: input.jobId,
      status: "skipped",
      stepsRun: 0,
      progress: existing?.progressDone ?? 0,
      total: existing?.progressTotal ?? 0,
    };
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

  while (done < total) {
    const estimate =
      slowestStepMs > 0
        ? slowestStepMs * STEP_SAFETY_FACTOR
        : INITIAL_STEP_ESTIMATE_MS;

    if (input.remainingMs() < estimate + CHECKPOINT_RESERVE_MS) {
      // YIELD (§ 3.3). Stop before the kill and hand the rest to a fresh
      // invocation. The job stays `running`, which is why `claim` permits
      // re-claiming a running job, and `attempts` has already been incremented
      // — so a job that cannot make progress still terminates at `max_attempts`
      // rather than re-enqueuing itself forever.
      try {
        await queue.send({ jobId: claimed.id });
      } catch (error) {
        // Nothing will pick the job back up. Fail it now rather than leave it
        // `running` to be reaped as `stale` 15 minutes later — the work done so
        // far is already checkpointed and the user gets a real error promptly.
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
      });
    } catch (error) {
      const failure = classifyError(error);
      if (failure.retryable && claimed.attempts < claimed.maxAttempts) {
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
