import { initSentry, wrapLambda } from "./shared/sentry";
import {
  defaultContext,
  runCoachScheduler,
  type SchedulerResult,
} from "./application/coaching/scheduler/coachScheduler";
import { COACH_SCHEDULER_JOBS } from "./application/coaching/scheduler/jobs";

/**
 * `coachSchedulerCron` — every 15 minutes via `sst.aws.Cron` in infra/api.ts
 * (PER-117, design C D2). Runs the coach scheduler's bounded, idempotent jobs:
 * weekly/daily forms, missed forms, form pushes and reminders, invite expiry,
 * programmes ending, training behind, and coach pushes (quiet hours).
 *
 * Logs `[coach-scheduler:summary]` every run. A failed job is retried on the
 * next tick and fails this invocation, so the cron's error alarm fires.
 */
async function baseHandler(): Promise<SchedulerResult> {
  const result = await runCoachScheduler(
    COACH_SCHEDULER_JOBS,
    defaultContext(),
  );
  console.log(`[coach-scheduler:summary] ${JSON.stringify(result)}`);
  const failed = Object.entries(result.jobs).filter(
    ([, outcome]) => outcome.status === "failed",
  );
  if (failed.length > 0) {
    throw new Error(
      `coach scheduler jobs failed: ${failed.map(([name]) => name).join(", ")}`,
    );
  }
  return result;
}

initSentry();
export const handler = wrapLambda(baseHandler);
