import Elysia from "elysia";
import { SavedGymService } from "../../repositories/savedGymService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/**
 * GET /saved-gyms — the CALLER's saved equipment sets, newest first.
 *
 * Loadout (spec-21) AC-7.1 / AC-7.2. Scoped to `userId` from the validated JWT;
 * there is no cross-user read path (sharing saved gyms between users is an
 * explicit non-goal).
 */
export const savedGymsListHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(SavedGymService)
  .get("/saved-gyms", async (ctx) => {
    const { sub: userId } = getUser(ctx);
    const gyms = await ctx.SavedGymRepository.list(userId);
    return { data: gyms };
  });
