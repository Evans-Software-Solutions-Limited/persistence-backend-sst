import type { AiJob } from "@persistence/db";
import type { JobError, JobStatus } from "./types";

/**
 * The job lifecycle's PURE decisions and the thresholds behind them —
 * `specs/_shared/async-jobs/design.md` § 3.1 / § 3.4.
 *
 * Its own module because both the repository (which enforces these in SQL) and
 * the read path (which derives them for the wire) need them, and importing one
 * from the other made a cycle. Nothing here touches the database or the clock
 * except through an injected `now`, so every rule below is directly testable.
 */

/**
 * How long a `running` job may be silent before ANOTHER worker may take it over.
 *
 * This is the fence that makes re-claiming a `running` job safe. Without it a
 * duplicate delivery could claim a job that is *actively running* and execute the
 * same steps concurrently — two workers interleaving checkpoint writes, with
 * `progress_done` able to move backwards.
 *
 * 5 minutes is far longer than any step should take between heartbeats (the spine
 * writes one after every step, and a kind with a longer step must call the
 * `heartbeat()` its step context provides). It is far SHORTER than
 * `STALE_AFTER_MS`, and it has to be: a hard-killed job must become re-claimable
 * long before it is declared dead to the client, or its checkpoint is lost.
 */
export const CLAIM_FENCE_MS = 5 * 60 * 1000;

/**
 * When a `running` job is declared dead to the CLIENT.
 *
 * ⚠ THIS MUST EXCEED THE QUEUE'S VISIBILITY TIMEOUT PLUS A FULL WORKER RUN, and
 * an earlier revision sized it against the worker timeout alone (15 min) — wrong
 * in a way that costs money. A retryable step failure 30 s into an invocation
 * leaves the message invisible for the whole 16-minute visibility timeout while
 * the heartbeat sits at 30 s. At 15 minutes the poll endpoint would report
 * `failed`/`stale` — "Nothing was saved; try again" — during the gap before
 * redelivery, so a client following the documented "stop polling on a terminal
 * status" contract gives up, the user re-runs and double-spends, while the
 * original job is quietly redelivered and succeeds.
 *
 * 40 minutes = 16 min visibility + 15 min worker run + margin. Deliberately a
 * loose upper bound: too high costs a client some waiting on a genuinely dead
 * job, too low costs duplicate spend and a discarded checkpoint.
 */
export const STALE_AFTER_MS = 40 * 60 * 1000;

/**
 * How long a job may sit `queued` before it is given up on.
 *
 * A message can die before it is ever claimed: throttled receives count toward
 * the redrive policy, so a burst against the worker's concurrency cap can
 * send a message to the DLQ having never executed. Nothing about `running`
 * staleness covers that — the row stays `queued` forever, so the client polls it
 * indefinitely AND the terminal-job purge never sees it.
 *
 * Sized off the redrive policy, not the worker: 3 receives × a 16-minute
 * visibility timeout is ~48 minutes to reach the DLQ, so 60 minutes clears the
 * window in which a failing message could still be retried.
 *
 * ⚠ It does NOT prove the message is gone under BACKLOG. A cap of 5 against a
 * ~5-minute job caps throughput near 60 jobs/hour, and a message waiting behind a
 * backlog is never RECEIVED — so its receive count never increments and it never
 * reaches the DLQ. A burst of more than ~60 distinct users would have its tail
 * reaped as "never started" while those messages are still perfectly alive; when
 * one lands, the row is terminal, the claim is refused and the message is deleted.
 * That degrades gracefully (no wasted spend, and the user can retry) and is
 * unreachable at pre-launch volume — but if throughput ever becomes the binding
 * constraint, this threshold has to grow with the backlog, not with the redrive
 * policy.
 */
export const QUEUED_STALE_AFTER_MS = 60 * 60 * 1000;

/** Terminal states — a job here will never run again. */
export const TERMINAL_STATUSES: readonly JobStatus[] = [
  "succeeded",
  "failed",
  "cancelled",
];

/**
 * The two give-up errors, defined once and shared by the read path (which DERIVES
 * them) and the nightly sweep (which PERSISTS them), so the client never sees the
 * message change when the sweep catches up with the derivation.
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

/**
 * Is this `running` job dead? — AC-2.5.
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
 * Has this job sat `queued` so long that its message must be gone?
 *
 * ⚠ Measured from `updatedAt`, NOT `createdAt`. `queued` has two meanings — never
 * started, and released mid-flight by a time-budget yield — and an earlier
 * revision measured from `createdAt`, which conflated them: a legitimately long
 * job (the design's own 120-step worked example is ~45 min, and one visibility
 * wait after a retry puts it past an hour) would read as "never started and was
 * ended" while it was mid-flight and about to resume. Worse, if the nightly sweep
 * landed in that window it killed the row for real and the resuming worker lost
 * every checkpointed step.
 *
 * `updatedAt` is the right clock for both meanings and needs no extra column: for
 * a never-started job it equals `createdAt`, and `releaseForResume` stamps it on
 * every yield, so the timer restarts each time the job is genuinely handed back.
 * No other writer leaves a row `queued`.
 */
export function isStaleQueued(job: AiJob, now: Date = new Date()): boolean {
  if (job.status !== "queued") return false;
  return now.getTime() - job.updatedAt.getTime() > QUEUED_STALE_AFTER_MS;
}

/**
 * Is a `running` job still held by a LIVE worker? — the JS mirror of the claim's
 * heartbeat fence.
 *
 * ⚠ This and `AiJobRepository.claim`'s SQL predicate must stay in step. The SQL is
 * what enforces mutual exclusion (it has to be, atomically, in one statement);
 * this is what the worker consults after LOSING a claim, to tell "another worker
 * is on it" from "the row is dead". Out of step, nothing corrupts — but the worker
 * draws one of the two wrong conclusions: failing a job another worker is actively
 * running, or deleting the message for a job nothing will pick up again.
 */
export function isWarmRunning(job: AiJob, now: Date = new Date()): boolean {
  if (job.status !== "running") return false;
  if (job.heartbeatAt == null) return false;
  return now.getTime() - job.heartbeatAt.getTime() <= CLAIM_FENCE_MS;
}

/** Non-terminal: the job could still run. */
export function isLive(job: AiJob): boolean {
  return job.status === "queued" || job.status === "running";
}

/** Either bound spent. Out of budget means the job can never be claimed again. */
export function isOutOfBudget(job: AiJob): boolean {
  return (
    job.attempts >= job.maxAttempts || job.invocations >= job.maxInvocations
  );
}
