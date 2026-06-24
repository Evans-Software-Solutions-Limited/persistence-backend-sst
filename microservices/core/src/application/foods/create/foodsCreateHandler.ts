import Elysia, { t } from "elysia";
import { FoodService } from "../../repositories/foodService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/** POST /foods — user creates a custom food (source = 'user'). */
export const foodsCreateHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(FoodService)
  .post(
    "/foods",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const food = await ctx.FoodRepository.create(userId, {
        name: ctx.body.name,
        brand: ctx.body.brand,
        barcode: ctx.body.barcode,
        kcal: ctx.body.kcal,
        proteinG: ctx.body.proteinG,
        carbsG: ctx.body.carbsG,
        fatG: ctx.body.fatG,
        servingSize: ctx.body.servingSize,
        servingUnit: ctx.body.servingUnit,
        source: "user",
      });
      ctx.set.status = 201;
      return { data: food };
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        brand: t.Optional(t.String()),
        barcode: t.Optional(t.String()),
        // minimum: 0 — no negative macros; serving size must be positive
        // (a 0/negative size breaks per-serving scaling). Review fix (PR #124).
        kcal: t.Number({ minimum: 0 }),
        proteinG: t.Number({ minimum: 0 }),
        carbsG: t.Number({ minimum: 0 }),
        fatG: t.Number({ minimum: 0 }),
        servingSize: t.Number({ exclusiveMinimum: 0 }),
        servingUnit: t.String(),
      }),
    },
  );
