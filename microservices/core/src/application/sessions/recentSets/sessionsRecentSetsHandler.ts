import Elysia from "elysia";
import { SessionService } from "../../repositories/sessionService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/**
 * GET /sessions/recent-sets
 *
 * The authenticated user's most-recent logged weight+reps for every
 * (exercise, setNumber). Lets the mobile client hydrate its device-local
 * "Previous" hint cache (`user_history.recent_sets`) on login.
 *
 * Background: V2's previous-set hints are cached device-local and were only
 * ever written when a session is completed ON that device — there was no
 * server backfill. So a fresh install (new phone, App Store install after
 * TestFlight, reinstall) showed no "Previous" hints even though the full set
 * history is safe on the server. This endpoint closes that gap; the client
 * calls it once when the local cache is empty and upserts the result.
 *
 * Ownership: `userId` comes from the validated JWT and scopes every row (see
 * `SessionRepository.getRecentSets`) — a user can only ever read their own
 * history. Registered BEFORE `GET /sessions/:sessionId` so the static
 * `recent-sets` segment is never captured as a `:sessionId` param.
 *
 * Response shape matches the mobile `RecentSetEntry`:
 *   { exerciseId, setNumber, weightKg (number), reps (number), recordedAt (ISO) }
 */
export const sessionsRecentSetsHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(SessionService)
  .get("/sessions/recent-sets", async (ctx) => {
    const { sub: userId } = getUser(ctx);

    const rows = await ctx.SessionRepository.getRecentSets(userId);

    const data = rows
      // A null `recordedAt` (both completed_at and started_at null) can't
      // carry a "previous" timestamp — drop it rather than emit null.
      .filter((r) => r.recordedAt != null)
      .map((r) => ({
        exerciseId: r.exerciseId,
        setNumber: r.setNumber,
        // NUMERIC → string over the wire; the mobile cache stores a number.
        weightKg: Number(r.weightKg),
        reps: r.reps,
        recordedAt: (r.recordedAt as Date).toISOString(),
      }));

    return { data };
  });
