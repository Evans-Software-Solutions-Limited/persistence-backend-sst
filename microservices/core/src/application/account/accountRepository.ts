import { getDb } from "@persistence/db/client";
import { ACCOUNT_DELETION_STEPS, buildStatement } from "./accountDeletionPlan";

/**
 * Account-level data operations (08-profile-settings § Revised 2026-06-28).
 */
export class AccountRepository {
  /**
   * Permanently delete every row the user owns, in one transaction.
   *
   * Atomic (any failure rolls back — no half-deleted account) and idempotent
   * (every step keys on `userId`, so a retry after a transient failure
   * deletes zero rows). Does NOT touch the Supabase `auth.users` record —
   * that is removed separately by the Admin REST call after this commits,
   * because `auth.users` lives outside the application database role.
   */
  async purgeUserData(userId: string): Promise<void> {
    const db = getDb();
    await db.transaction(async (tx) => {
      for (const step of ACCOUNT_DELETION_STEPS) {
        await tx.execute(buildStatement(step, userId));
      }
    });
  }
}
