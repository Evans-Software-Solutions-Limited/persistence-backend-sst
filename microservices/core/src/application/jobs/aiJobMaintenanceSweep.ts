/**
 * Nightly maintenance for the async-job spine —
 * `specs/_shared/async-jobs/design.md` § 7.
 *
 * Rides the existing 05:00 UTC `account-purge-sweep` schedule rather than
 * adding a sixth `sst.aws.Cron`. Two reasons: the cadence is already right, and
 * a new scheduled function costs account Lambda concurrency (shared with two
 * sibling products — `infra/monitoring.ts` documents what that scarcity has
 * already cost) for what amounts to two statements.
 *
 * It is deliberately a SEPARATE function from `accountPurgeCron` rather than a
 * step inside its per-user loop: this work is table-wide, not per-user, and
 * folding it in would put an unrelated failure mode inside a compliance-
 * critical sweep.
 */

/** 30 days. A job row holds a whole generated programme, not a log line. */
export const JOB_RETENTION_DAYS = 30;

export interface AiJobMaintenanceRepo {
  markStaleRunning(now: Date): Promise<number>;
  markStaleQueued(now: Date): Promise<number>;
  purgeTerminalOlderThan(cutoff: Date): Promise<number>;
}

export interface AiJobMaintenanceSummary {
  /** `running` jobs whose worker died, given a terminal state. */
  staleReaped: number;
  /** `queued` jobs whose message died before it was ever claimed. */
  queuedReaped: number;
  /** Terminal jobs older than the retention window, deleted. */
  purged: number;
  /** A step threw. Counted rather than propagated — see below. */
  failed: number;
}

export async function aiJobMaintenanceSweep(deps: {
  repo: AiJobMaintenanceRepo;
  now: Date;
}): Promise<AiJobMaintenanceSummary> {
  const summary: AiJobMaintenanceSummary = {
    staleReaped: 0,
    queuedReaped: 0,
    purged: 0,
    failed: 0,
  };

  // Reap first, purge second — deliberately in this order. Reaping moves a
  // dead job to terminal with `finished_at` set, which is what makes it eligible
  // for purging; doing it the other way round leaves every reaped job waiting a
  // further 30 days for the next sweep to notice it.
  //
  // ⚠ Reaping is only the PERSISTENCE of staleness. `GET /jobs/:id` derives the
  // same verdicts on read, so a client is never wedged on a dead job even if
  // this sweep is broken or unscheduled. That redundancy is why each step is
  // isolated below rather than allowed to abort the sweep.
  try {
    summary.staleReaped = await deps.repo.markStaleRunning(deps.now);
  } catch (err) {
    summary.failed += 1;
    console.error("[ai-job-maintenance] stale reap failed:", err);
  }

  // The other half of the give-up contract, and it is NOT covered by the reap
  // above: a message that dies before its first receive leaves a `queued` row
  // that nothing ever transitions. Throttled receives count toward the redrive
  // policy, so a burst against the worker's reserved concurrency really can send
  // a message to the DLQ having never executed.
  try {
    summary.queuedReaped = await deps.repo.markStaleQueued(deps.now);
  } catch (err) {
    summary.failed += 1;
    console.error("[ai-job-maintenance] queued reap failed:", err);
  }

  try {
    const cutoff = new Date(
      deps.now.getTime() - JOB_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );
    summary.purged = await deps.repo.purgeTerminalOlderThan(cutoff);
  } catch (err) {
    summary.failed += 1;
    console.error("[ai-job-maintenance] terminal purge failed:", err);
  }

  return summary;
}
