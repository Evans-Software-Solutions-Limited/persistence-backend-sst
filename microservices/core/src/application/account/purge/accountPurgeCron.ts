/**
 * Nightly account-purge sweep (Cluster 2a Part D). Scheduled via
 * `sst.aws.Cron` in infra/api.ts. Completes the 30-day soft-delete flow:
 * `DELETE /account` only stamps `deleted_at`/`purge_after` — this worker
 * finds every account whose cooling-off window has elapsed and runs the
 * REAL purge + auth-user delete that the old immediate-delete handler used
 * to do synchronously.
 *
 * Per-user order (brief Part D): safety-net Stripe cancel → SQL purge (the
 * corrected `ACCOUNT_DELETION_STEPS` plan, Part A) → Supabase auth-user
 * delete → best-effort avatar S3 cleanup (Part B). One user's failure is
 * isolated — logged and counted, never aborts the batch — mirroring
 * `volumeCron`/`streakCron`'s per-user try/catch convention.
 */
export interface AccountPurgeCronRepo {
  listPendingPurge(now: Date): Promise<string[]>;
  purgeUserData(userId: string): Promise<void>;
}

export interface AccountPurgeCronDeps {
  accountRepo: AccountPurgeCronRepo;
  /** `cancelStripeSubscriptions` — safety net in case a sub was
   * created/reactivated during the 30-day window since the original
   * `DELETE /account` cancel. Non-fatal: logged and the purge proceeds
   * regardless, because the 30-day deadline takes priority over a Stripe
   * hiccup — the user's data is going either way. */
  cancelStripeSubscriptions: (userId: string) => Promise<void>;
  /** `deleteAuthUserWithRetry` — removes the Supabase `auth.users` row.
   * Non-fatal: logged for ops cleanup, same posture as the original
   * immediate-delete handler (the SQL purge already committed by this
   * point, so the user's data is gone regardless of this step's outcome). */
  deleteAuthUser: (userId: string) => Promise<void>;
  /** Best-effort S3 avatar cleanup (Part B). Swallows its own errors —
   * never throws — but typed as a Promise for uniformity with the rest of
   * the per-user pipeline. */
  deleteAvatar: (userId: string) => Promise<void>;
  now: Date;
}

export interface AccountPurgeCronSummary {
  /** Accounts whose cooling-off window had elapsed at sweep time. */
  pending: number;
  /** Successfully purged (SQL data gone — auth-delete/avatar failures still
   * count as purged, since the compliance-critical step succeeded). */
  purged: number;
  /** The SQL purge itself failed for this user — retried on the next sweep
   * (idempotent: `purgeUserData` deletes zero rows for an already-purged
   * user, and the user still matches `listPendingPurge` because `profiles`
   * — and therefore `deleted_at`/`purge_after` — wasn't touched). */
  failed: number;
}

export async function accountPurgeCron(
  deps: AccountPurgeCronDeps,
): Promise<AccountPurgeCronSummary> {
  const userIds = await deps.accountRepo.listPendingPurge(deps.now);
  const summary: AccountPurgeCronSummary = {
    pending: userIds.length,
    purged: 0,
    failed: 0,
  };

  for (const userId of userIds) {
    try {
      // 1. Safety-net Stripe cancel. Non-fatal — log and proceed regardless
      //    (see AccountPurgeCronDeps.cancelStripeSubscriptions doc).
      try {
        await deps.cancelStripeSubscriptions(userId);
      } catch (err) {
        console.error(
          `[account-purge-cron] Stripe safety-net cancel failed for ${userId} — proceeding with purge:`,
          err,
        );
      }

      // 2. The compliance-critical step: SQL purge via the corrected plan.
      //    A failure here is NOT swallowed — it's the one step that must
      //    retry on the next sweep rather than being marked done.
      await deps.accountRepo.purgeUserData(userId);
      summary.purged += 1;

      // 3. Supabase auth-user delete. Non-fatal (data is already gone).
      try {
        await deps.deleteAuthUser(userId);
      } catch (err) {
        console.error(
          `[account-purge-cron] auth-user delete failed for ${userId} after purge (ops cleanup needed):`,
          err,
        );
      }

      // 4. Best-effort avatar cleanup (Part B). `deleteAvatar` swallows its
      //    own errors, but guard anyway so a surprise throw here can never
      //    downgrade an otherwise-successful purge to "failed".
      try {
        await deps.deleteAvatar(userId);
      } catch (err) {
        console.error(
          `[account-purge-cron] avatar cleanup threw unexpectedly for ${userId}:`,
          err,
        );
      }
    } catch (err) {
      summary.failed += 1;
      console.error(`[account-purge-cron] purge failed for ${userId}:`, err);
    }
  }

  return summary;
}
