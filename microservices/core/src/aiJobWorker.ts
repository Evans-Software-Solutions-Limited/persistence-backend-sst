import type { Context, SQSEvent } from "aws-lambda";
import { initSentry, wrapLambda } from "./shared/sentry";
import { runJob } from "./application/jobs/runJob";
import type { JobMessage } from "./application/jobs/types";

/**
 * The async-job worker — `specs/_shared/async-jobs/design.md` § 1.
 *
 * Subscribed to `AiJobQueue` in `infra/jobs.ts` with **`batch.size = 1`**: one
 * job per invocation. A batch of ten five-minute jobs cannot finish inside one
 * 900 s invocation, and partial-batch-failure reporting would be a second,
 * entirely avoidable correctness problem.
 *
 * ## Throwing is the retry mechanism
 *
 * A thrown error leaves the SQS message unacked; it becomes visible again after
 * the visibility timeout and is redelivered, up to the redrive policy's
 * `maxReceiveCount`, then goes to the DLQ. So this handler throws ONLY when a
 * retry is wanted. Every terminal outcome — success, non-retryable failure,
 * attempts exhausted, and a duplicate delivery that lost the claim — returns
 * normally so the message is deleted.
 *
 * ## Duplicate delivery is expected, not exceptional
 *
 * SQS is at-least-once. `runJob`'s claim is a single conditional UPDATE, so a
 * duplicate simply loses it and returns `skipped`. That is the whole
 * exactly-once story (AC-3.1) and the reason an expensive job cannot be run
 * twice by a redelivery.
 */
async function baseHandler(
  event: SQSEvent,
  context: Context,
): Promise<{ jobId: string | null; status: string; stepsRun: number }> {
  const record = event.Records?.[0];
  if (!record) {
    // An empty batch is not a real Lambda invocation shape, but returning
    // rather than throwing keeps a malformed event from looping on the queue.
    console.warn("[ai-job:summary] empty SQS batch — nothing to do");
    return { jobId: null, status: "empty", stepsRun: 0 };
  }

  let message: JobMessage;
  try {
    message = JSON.parse(record.body) as JobMessage;
  } catch {
    // Unparseable body: no job id, so nothing can be marked failed and no retry
    // could ever succeed. Return so the message is deleted rather than looping
    // to the DLQ; the log line is the only actionable artefact.
    console.error(
      `[ai-job:summary] ${JSON.stringify({
        status: "unparseable",
        messageId: record.messageId,
      })}`,
    );
    return { jobId: null, status: "unparseable", stepsRun: 0 };
  }

  if (typeof message?.jobId !== "string" || message.jobId.length === 0) {
    console.error(
      `[ai-job:summary] ${JSON.stringify({
        status: "no_job_id",
        messageId: record.messageId,
      })}`,
    );
    return { jobId: null, status: "no_job_id", stepsRun: 0 };
  }

  const startedAt = Date.now();
  const outcome = await runJob({
    jobId: message.jobId,
    // The real remaining-time signal. This is what makes the yield in
    // `runJob` (§ 3.3) a stop-before-the-kill rather than a guess — a hard-kill
    // runs no `finally`, so there is no recovery after the deadline.
    remainingMs: () => context.getRemainingTimeInMillis(),
  });

  // One line per job, same convention as the existing crons
  // (`[reconcile:summary]`, `[streak-cron:summary]`) — AC-5.3.
  console.log(
    `[ai-job:summary] ${JSON.stringify({ ...outcome, ms: Date.now() - startedAt })}`,
  );

  return {
    jobId: outcome.jobId,
    status: outcome.status,
    stepsRun: outcome.stepsRun,
  };
}

// Initialise Sentry (no-op without SENTRY_DSN) and wrap so thrown errors are
// captured + flushed before the container freezes. A throw here is deliberate
// (it is the SQS retry mechanism), so these will show up in Sentry as retries
// rather than as unhandled crashes — that is intended: a job retrying is worth
// seeing.
initSentry();
export const handler = wrapLambda(baseHandler);
