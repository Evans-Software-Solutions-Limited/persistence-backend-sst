import Elysia from "elysia";
import { MealService } from "../../repositories/mealService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/** GET /meals — the user's saved meal presets (cards; items omitted). */
export const mealsListHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(MealService)
  .get("/meals", async (ctx) => {
    const { sub: userId } = getUser(ctx);
    const meals = await ctx.MealRepository.list(userId);
    return { data: meals };
  });
