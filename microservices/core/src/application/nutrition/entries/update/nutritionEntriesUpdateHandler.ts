import Elysia, { t } from "elysia";
import { NutritionEntryService } from "../../../repositories/nutritionEntryService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/**
 * PUT /nutrition/entries/:id — edit servings/slot/macros of an owned entry.
 * Ownership is folded into the mutation WHERE; a non-match returns 404 (don't
 * leak existence). Macros are taken as provided here — the client recomputes
 * from the cached food/recipe on edit (same trust posture as the create path).
 */
export const nutritionEntriesUpdateHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(NutritionEntryService)
  .put(
    "/nutrition/entries/:id",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const updated = await ctx.NutritionEntryRepository.update(
        ctx.params.id,
        userId,
        ctx.body,
      );

      if (!updated) {
        ctx.set.status = 404;
        return { error: "entry_not_found" };
      }

      return { data: updated };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        mealSlot: t.Optional(
          t.Union([
            t.Literal("breakfast"),
            t.Literal("lunch"),
            t.Literal("snack"),
            t.Literal("dinner"),
          ]),
        ),
        servings: t.Optional(t.Number()),
        kcal: t.Optional(t.Number()),
        proteinG: t.Optional(t.Number()),
        carbsG: t.Optional(t.Number()),
        fatG: t.Optional(t.Number()),
      }),
    },
  );
