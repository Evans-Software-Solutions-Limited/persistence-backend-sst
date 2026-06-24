import Elysia, { t } from "elysia";
import { FoodService } from "../../repositories/foodService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/** GET /foods?query= — search global + the caller's own custom foods. */
export const foodsListHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(FoodService)
  .get(
    "/foods",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const foods = await ctx.FoodRepository.search(ctx.query.query, userId);
      return { data: foods };
    },
    {
      query: t.Object({ query: t.String() }),
    },
  );
