import Elysia from "elysia";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { AccountRepository } from "../accountRepository";
import { getSupabaseAdminConfig, deleteAuthUser } from "../supabaseAdminClient";

const accountRepository = new AccountRepository();

/**
 * `DELETE /account` — permanently delete the caller's account (08-profile-
 * settings § Revised 2026-06-28, STORY-011; App Store Guideline 5.1.1(v)).
 *
 * Acts only on the authenticated caller's own `userId` (from the JWT — never
 * an id from the body). Flow:
 *   1. Fail fast (500) if the Supabase service-role key is unset — BEFORE any
 *      purge, so an unconfigured stage never half-deletes an account.
 *   2. Atomically purge all of the caller's owned data (one transaction).
 *   3. Delete the Supabase `auth.users` record so the login is gone.
 *
 * Idempotent: a retry after a transient failure purges zero rows and treats an
 * already-deleted auth user (404) as success.
 */
export const accountDeleteHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .delete("/account", async (ctx) => {
    const { sub: userId } = getUser(ctx);

    try {
      getSupabaseAdminConfig();
    } catch {
      ctx.set.status = 500;
      return { error: "Account deletion is not configured" };
    }

    try {
      await accountRepository.purgeUserData(userId);
      await deleteAuthUser(userId);
    } catch (err) {
      console.error("[account:delete] failed:", err);
      ctx.set.status = 500;
      return { error: "Failed to delete account" };
    }

    return { data: { deleted: true } };
  });
