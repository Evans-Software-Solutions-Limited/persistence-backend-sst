import Elysia, { t } from "elysia";
import { RecipeService } from "../../repositories/recipeService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/** GET /recipes/:id — full recipe with ingredients (ownership in WHERE → 404). */
export const recipesGetHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(RecipeService)
  .get(
    "/recipes/:id",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const recipe = await ctx.RecipeRepository.getById(ctx.params.id, userId);
      if (!recipe) {
        ctx.set.status = 404;
        return { error: "recipe_not_found" };
      }
      return { data: recipe };
    },
    { params: t.Object({ id: t.String() }) },
  );
