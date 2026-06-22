import Elysia from "elysia";
import { NutritionTargetService } from "../../../repositories/nutritionTargetService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/** GET /nutrition/targets — current targets (or null if never set). */
export const nutritionTargetsGetHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(NutritionTargetService)
  .get("/nutrition/targets", async (ctx) => {
    const { sub: userId } = getUser(ctx);
    const target = await ctx.NutritionTargetRepository.get(userId);
    return { data: target };
  });
