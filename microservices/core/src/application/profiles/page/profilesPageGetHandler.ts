import Elysia from "elysia";
import { ProfileService } from "../../repositories/profileService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/**
 * GET /profile/page — aggregated payload for the mobile Profile tab.
 *
 * Returns the full `ProfilePageData` envelope in a single round-trip so
 * the mobile app can render the screen from one SQLite cache slot. See
 * specs/milestones/M6-profile/BACKEND_BRIEF.md for the contract.
 *
 * Auth is required — there is no anonymous "preview" mode for the
 * profile page. Returns 404 when the `profiles` row for the JWT's
 * `sub` doesn't exist (defensive — shouldn't happen after signup).
 */
export const profilesPageGetHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(ProfileService)
  .get("/profile/page", async (ctx) => {
    const { sub: userId } = getUser(ctx);

    const data = await ctx.ProfileRepository.getProfilePageData(userId);
    if (data === null) {
      ctx.set.status = 404;
      return { error: "Profile not found" };
    }

    return { data };
  });
