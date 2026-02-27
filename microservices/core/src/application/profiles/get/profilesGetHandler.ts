import Elysia from "elysia";
import { ProfileService } from "../../repositories/profileService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

export const profilesGetHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(ProfileService)
  .get("/profile", async (ctx) => {
    const { sub: userId } = getUser(ctx);

    const profile = await ctx.ProfileRepository.getById(userId);

    if (!profile) {
      ctx.set.status = 404;
      return { error: "Profile not found" };
    }

    return { data: profile };
  });
