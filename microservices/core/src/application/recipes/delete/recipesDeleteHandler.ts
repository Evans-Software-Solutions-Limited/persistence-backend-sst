import Elysia, { t } from "elysia";
import { RecipeService } from "../../repositories/recipeService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/** DELETE /recipes/:id — ownership in WHERE → 404; ingredients cascade. */
export const recipesDeleteHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(RecipeService)
  .delete(
    "/recipes/:id",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const deleted = await ctx.RecipeRepository.delete(ctx.params.id, userId);
      if (!deleted) {
        ctx.set.status = 404;
        return { error: "recipe_not_found" };
      }
      return { data: { id: ctx.params.id, deleted: true } };
    },
    { params: t.Object({ id: t.String() }) },
  );
