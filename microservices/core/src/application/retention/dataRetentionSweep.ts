/**
 * Nightly data-retention sweep — the mechanism behind the retention promises in
 * the published privacy policy (`packages/web/src/pages/Privacy.tsx` and
 * `packages/mobile/.../PrivacyPolicyPresenter.tsx`).
 *
 * ## Why this exists rather than calling `cleanup_old_health_data()`
 *
 * The 12-month retention rule was already written in SQL
 * (`supabase/migrations/20260117235501_health_data_retention_policies.sql`,
 * extended by `20260721000000_client_data_access_log.sql`) — but nothing ever
 * ran it. That function is `SECURITY DEFINER` and gated on
 * `auth.uid()` resolving to an `admin` profile, and no pg_cron is wired up in
 * this project, so in practice **no row was ever pruned**. The policy claimed a
 * rolling 12-month window the implementation did not deliver, which is an
 * accuracy problem in its own right (UK GDPR Art 5(1)(a)) on top of the storage
 * limitation one (Art 5(1)(e)).
 *
 * ⚠ Do NOT "fix" this by calling that function from the cron. The scheduled
 * Lambda reaches Postgres through the Transaction-mode pooler as the service
 * role, where `auth.uid()` is **NULL** — so the function's first guard raises
 * `Authentication required` and the sweep would fail every night while looking
 * wired up. Enforcing retention in the backend, where authorization is already
 * explicit, is the pattern this repo uses everywhere else.
 *
 * The SQL function is deliberately left in place as manual admin tooling.
 *
 * Pure logic + injected repo, so the sweep is deterministic under test; the
 * clock is read at the impure edge in `accountPurgeCron.ts`.
 */

/** Retention window for the categories swept here. Mirrors the 12 months in the
 *  SQL function above, and the "older than 12 months" wording in both copies of
 *  the privacy policy. Changing this number changes a published promise — update
 *  the policy in the same PR. */
export const RETENTION_MONTHS = 12;

export interface DataRetentionRepo {
  /**
   * Delete rows older than `cutoff` from every category on the 12-month clock,
   * returning the per-table counts. One call rather than three so the sweep
   * cannot half-apply a retention run.
   */
  pruneOlderThan(cutoff: Date): Promise<DataRetentionCounts>;
}

export interface DataRetentionCounts {
  /** Apple Health / provider daily activity rows (steps, resting HR, …). */
  dailyActivity: number;
  /** Apple Health / provider sleep rows. */
  sleep: number;
  /**
   * Coach read-audit rows (`specs/27-coach-health-data-read-audit`). High-volume
   * and only needed to cover a rolling compliance window — unlike
   * `trainer_actions_audit` (write audit), which is retained indefinitely by
   * design and is NOT swept here.
   */
  clientDataAccessLog: number;
}

export interface DataRetentionSweepDeps {
  repo: DataRetentionRepo;
  now: Date;
}

export interface DataRetentionSweepSummary extends DataRetentionCounts {
  /** The cutoff actually applied, as an ISO string — logged so an operator can
   *  confirm the window without recomputing it from the run timestamp. */
  cutoff: string;
  total: number;
}

/**
 * Compute the retention cutoff: `now` minus `RETENTION_MONTHS` calendar months,
 * clamped to the last valid day of the target month.
 *
 * ⚠ Deliberately NOT `setUTCMonth(m - 12)`. That OVERFLOWS rather than clamping:
 * 29 Feb 2028 minus 12 months yields 1 March 2027, because 29 Feb 2027 does not
 * exist. Overflow moves the cutoff FORWARD, which deletes a day of data the
 * policy still promises to keep — so the failure mode is silent data loss on
 * leap years, not a crash. Clamping to 28 Feb keeps the cutoff conservative.
 *
 * Exported so the test can pin the boundary directly.
 */
export function retentionCutoff(now: Date): Date {
  const monthsFromEpochMonth = now.getUTCMonth() - RETENTION_MONTHS;
  const targetYear =
    now.getUTCFullYear() + Math.floor(monthsFromEpochMonth / 12);
  const targetMonth = ((monthsFromEpochMonth % 12) + 12) % 12;

  // Day 0 of the following month is the last day of the target month.
  const daysInTargetMonth = new Date(
    Date.UTC(targetYear, targetMonth + 1, 0),
  ).getUTCDate();

  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      Math.min(now.getUTCDate(), daysInTargetMonth),
      now.getUTCHours(),
      now.getUTCMinutes(),
      now.getUTCSeconds(),
      now.getUTCMilliseconds(),
    ),
  );
}

export async function dataRetentionSweep(
  deps: DataRetentionSweepDeps,
): Promise<DataRetentionSweepSummary> {
  const cutoff = retentionCutoff(deps.now);
  const counts = await deps.repo.pruneOlderThan(cutoff);
  return {
    ...counts,
    cutoff: cutoff.toISOString(),
    total: counts.dailyActivity + counts.sleep + counts.clientDataAccessLog,
  };
}
