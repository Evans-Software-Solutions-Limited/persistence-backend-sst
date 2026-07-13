import Elysia from "elysia";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { AccountRepository } from "../accountRepository";

const accountRepository = new AccountRepository();

/**
 * `POST /account/restore` — cancel a pending soft-delete within the 30-day
 * cooling-off window (Cluster 2a). Acts only on the authenticated caller's
 * own `userId` (from the JWT).
 *
 * Clears `profiles.deleted_at` / `purge_after` when the account is currently
 * soft-deleted. If the nightly purge worker has ALREADY completed the delete
 * (data purged + auth user removed), the caller's JWT can no longer validate
 * against a live Supabase user, so this route is unreachable at that point —
 * there is no window where a request could race the worker and "restore"
 * a hard-deleted account.
 *
 * Not-currently-deleted is a 200 no-op (`restored: false`) rather than a 409
 * — restoring an account that was never soft-deleted (e.g. a stale mobile
 * screen, a double-tap) isn't a conflict from the caller's point of view,
 * just a no-op; the response shape lets the client tell the two cases apart
 * without treating either as an error.
 */
export const accountRestoreHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .post("/account/restore", async (ctx) => {
    const { sub: userId } = getUser(ctx);

    const outcome = await accountRepository.restore(userId);

    return { data: { restored: outcome === "restored" } };
  });
