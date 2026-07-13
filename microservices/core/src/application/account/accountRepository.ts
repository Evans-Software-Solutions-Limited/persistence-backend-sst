import { and, eq, isNotNull, lte } from "drizzle-orm";
import { profiles } from "@persistence/db";
import { getDb } from "@persistence/db/client";
import { ACCOUNT_DELETION_STEPS, buildStatement } from "./accountDeletionPlan";

/** The 30-day cooling-off window (Cluster 2a soft-delete). */
export const SOFT_DELETE_GRACE_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Account-level data operations (08-profile-settings § Revised 2026-06-28;
 * Cluster 2a 30-day soft-delete cooling-off).
 */
export class AccountRepository {
  /**
   * Permanently delete every row the user owns, in one transaction.
   *
   * Gated on the account still being soft-deleted (`deleted_at IS NOT NULL`),
   * re-checked under a `FOR UPDATE` row lock inside the transaction so it
   * serializes with `restore()` — a restore that commits first makes this a
   * no-op (deletes nothing). Atomic (any failure rolls back — no half-deleted
   * account) and idempotent (every step keys on `userId`, so a retry after a
   * transient failure deletes zero rows). Does NOT touch the Supabase
   * `auth.users` record — that is removed separately by the Admin REST call
   * after this commits, because `auth.users` lives outside the application
   * database role.
   */
  async purgeUserData(userId: string): Promise<void> {
    const db = getDb();
    await db.transaction(async (tx) => {
      // Serialize with POST /account/restore before deleting anything.
      // `listPendingPurge` is snapshotted once at the top of the nightly
      // sweep and the deletion steps key only on `userId`, so without this
      // a user who taps Restore mid-sweep (restore() sets deleted_at = NULL
      // and returns `restored: true`) would still be purged seconds later —
      // silent, irreversible data loss that defeats the cooling-off window.
      // Lock the profile row and re-confirm the soft-delete is still in
      // force INSIDE the transaction: FOR UPDATE makes restore()'s
      // conditional UPDATE and this SELECT contend for the same row, so
      // whichever commits first wins. If restore already cleared deleted_at,
      // this returns zero rows → abort, deleting nothing. (Cluster 2a — IB.)
      const stillSoftDeleted = await tx
        .select({ id: profiles.id })
        .from(profiles)
        .where(and(eq(profiles.id, userId), isNotNull(profiles.deletedAt)))
        .for("update");
      if (stillSoftDeleted.length === 0) return;

      for (const step of ACCOUNT_DELETION_STEPS) {
        await tx.execute(buildStatement(step, userId));
      }
    });
  }

  /**
   * Soft-delete: stamp `deleted_at` = `now` and `purge_after` = `now` +
   * {@link SOFT_DELETE_GRACE_PERIOD_MS}. Idempotent by design — a retry (or
   * a second `DELETE /account` call before the window elapses) simply
   * re-stamps both columns, extending the cooling-off window from "now"
   * rather than layering state. Does NOT touch any other table; the actual
   * purge is the nightly worker's job once `purge_after <= now()`.
   *
   * Returns the new `purgeAfter` so the handler can echo it in the response.
   */
  async softDelete(userId: string, now: Date = new Date()): Promise<Date> {
    const db = getDb();
    const purgeAfter = new Date(now.getTime() + SOFT_DELETE_GRACE_PERIOD_MS);
    await db
      .update(profiles)
      .set({ deletedAt: now, purgeAfter, updatedAt: now })
      .where(eq(profiles.id, userId));
    return purgeAfter;
  }

  /**
   * Restore (cancel a pending soft-delete): clears `deleted_at` /
   * `purge_after` for the caller, but ONLY when the account is currently
   * soft-deleted — scoping the UPDATE's WHERE to `deleted_at IS NOT NULL`
   * makes a restore-of-an-active-account a no-op rowcount-0 rather than a
   * spurious `updated_at` bump. Returns `"restored"` / `"not_deleted"` so the
   * handler can pick a 200-no-op vs the restored body.
   *
   * If `purge_after` has already elapsed but the nightly worker hasn't run
   * yet, this still restores the account (the worker's own `deleted_at IS
   * NOT NULL` scan will simply no longer match it) — the grace period is a
   * worker-scheduling hint, not a hard cutoff enforced here.
   */
  async restore(userId: string): Promise<"restored" | "not_deleted"> {
    const db = getDb();
    const result = await db
      .update(profiles)
      .set({ deletedAt: null, purgeAfter: null, updatedAt: new Date() })
      .where(and(eq(profiles.id, userId), isNotNull(profiles.deletedAt)))
      .returning({ id: profiles.id });
    return result.length > 0 ? "restored" : "not_deleted";
  }

  /**
   * User ids whose cooling-off window has elapsed (`deleted_at IS NOT NULL
   * AND purge_after <= now`) — the nightly purge worker's input set.
   */
  async listPendingPurge(now: Date = new Date()): Promise<string[]> {
    const db = getDb();
    const rows = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(and(isNotNull(profiles.deletedAt), lte(profiles.purgeAfter, now)));
    return rows.map((r) => r.id);
  }
}
