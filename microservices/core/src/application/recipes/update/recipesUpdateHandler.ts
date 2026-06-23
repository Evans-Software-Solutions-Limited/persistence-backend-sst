import Elysia, { t } from "elysia";
import { RecipeService } from "../../repositories/recipeService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/**
 * PUT /recipes/:id — metadata update (name/photo/servings/instructions).
 * Ownership folded into the WHERE → 404. Ingredient editing in M9 is
 * delete-then-recreate at the client; totals are unaffected by a servings
 * change (they are absolute sums over ingredients).
 */
export const recipesUpdateHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(RecipeService)
  .put(
    "/recipes/:id",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const updated = await ctx.RecipeRepository.update(
        ctx.params.id,
        userId,
        ctx.body,
      );
      if (!updated) {
        ctx.set.status = 404;
        return { error: "recipe_not_found" };
      }
      return { data: updated };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1 })),
        photoUrl: t.Optional(t.String()),
        servings: t.Optional(t.Number({ exclusiveMinimum: 0 })), // PR #124
        instructions: t.Optional(t.String()),
      }),
    },
  );
