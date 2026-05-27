import Elysia from "elysia";
import { ProfileService } from "../../../repositories/profileService";
import { NOTIFICATION_PREFERENCES_PROFILE_MISSING } from "../../../repositories/profileRepository";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/**
 * GET /notifications/preferences — read the caller's per-type
 * notification preference map.
 *
 * The read path applies defaults for missing keys and drops any
 * stale/unknown keys still persisted in the JSONB column. An empty
 * column reads as "all enabled" — the default.
 *
 * Implements: specs/09-notifications-social/design.md
 *             § Backend endpoints > GET /notifications/preferences
 * Satisfies: specs/09-notifications-social/requirements.md AC 1.7
 */
export const preferencesGetHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(ProfileService)
  .get("/notifications/preferences", async (ctx) => {
    const { sub: userId } = getUser(ctx);

    const result =
      await ctx.ProfileRepository.getNotificationPreferences(userId);

    if (result === NOTIFICATION_PREFERENCES_PROFILE_MISSING) {
      ctx.set.status = 404;
      return { error: "Profile not found" };
    }

    return { data: result };
  });
