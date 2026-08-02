import type { AiJob } from "@persistence/db";
import { STALE_AFTER_MS } from "./aiJobRepository";
import type { JobError, JobStatus } from "./types";

export interface JobView {
  id: string;
  kind: string;
  status: JobStatus;
  progress: { done: number; total: number };
  result: unknown | null;
  error: JobError | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

const STALE_ERROR: JobError = {
  code: "stale",
  message:
    "The job stopped reporting progress and was ended. Nothing was saved; try again.",
  retryable: false,
};

/**
 * Is this `running` job dead? — design § 3.4, AC-2.5.
 *
 * A Lambda hard-kill, an OOM or a deploy mid-run leaves a job `running` with no
 * terminal state, because a hard-kill runs no `finally` block (the failure mode
 * `infra/api.ts` documents at length for the 20 s default timeout). A cold
 * heartbeat is the only evidence available.
 *
 * `heartbeatAt` is NULL only between the insert and the first claim, which is a
 * `queued` job — a `running` job with no heartbeat is a schema violation, and
 * treating it as stale is the safe reading.
 */
export function isStaleRunning(job: AiJob, now: Date = new Date()): boolean {
  if (job.status !== "running") return false;
  if (job.heartbeatAt == null) return true;
  return now.getTime() - job.heartbeatAt.getTime() > STALE_AFTER_MS;
}

/**
 * Project a job row for the wire, deriving staleness on READ.
 *
 * ⚠ Derived rather than depending on the nightly sweep, so a client is never
 * wedged polling a dead job even if the sweep is broken or unscheduled. And
 * this function does NOT write: a GET that mutates would put a write on every
 * tick of a 2-second poll loop. The sweep persists the same verdict separately
 * (`markStaleRunning`), which is what makes the row purgeable.
 */
export function toJobView(job: AiJob, now: Date = new Date()): JobView {
  const stale = isStaleRunning(job, now);
  return {
    id: job.id,
    kind: job.kind,
    status: stale ? "failed" : (job.status as JobStatus),
    progress: { done: job.progressDone, total: job.progressTotal },
    // A stale job's partial `result` is never returned — it is by definition
    // incomplete, and a caller cannot tell a truncated programme from a whole
    // one.
    result: stale ? null : (job.result ?? null),
    error: stale ? STALE_ERROR : ((job.error as JobError | null) ?? null),
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  };
}

/**
 * The envelope without the payload, for the polling loop (design § 2.2).
 *
 * A completed 120-workout programme is a large document, and the poll loop a
 * client writes first re-downloads it on every tick after completion. Consumers
 * should poll with `?fields=status` and fetch the full row once, on the
 * transition to a terminal status.
 */
export function toJobStatusView(
  job: AiJob,
  now: Date = new Date(),
): Omit<JobView, "result"> {
  // `delete` on a copy rather than a destructured `_result` rest-spread: the
  // latter trips `no-unused-vars` on the discarded binding, and disabling the
  // rule for a line is worse than one explicit statement.
  const view: Partial<JobView> = { ...toJobView(job, now) };
  delete view.result;
  return view as Omit<JobView, "result">;
}
