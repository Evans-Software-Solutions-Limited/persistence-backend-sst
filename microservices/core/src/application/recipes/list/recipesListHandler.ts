import Elysia from "elysia";
import { RecipeService } from "../../repositories/recipeService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/** GET /recipes — the user's recipes (cards; ingredients omitted for size). */
export const recipesListHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(RecipeService)
  .get("/recipes", async (ctx) => {
    const { sub: userId } = getUser(ctx);
    const recipes = await ctx.RecipeRepository.list(userId);
    return { data: recipes };
  });
