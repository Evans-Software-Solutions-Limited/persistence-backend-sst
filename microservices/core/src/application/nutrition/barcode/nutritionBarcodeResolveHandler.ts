import Elysia, { t } from "elysia";
import { FoodService } from "../../repositories/foodService";
import {
  resolveBarcodeFromOFF,
  OpenFoodFactsUnavailableError,
} from "./services/openFoodFacts";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/**
 * POST /nutrition/barcode/resolve — { code } → Food.
 *
 * Cache-first (DATA_SOURCING.md § 2/§ 5): hit the local `foods` table first
 * (warmed by the curated OFF seed + prior scans), so the rate-limited OFF API
 * is only touched on a true miss. On an OFF miss → 404 (user adds manually);
 * on OFF being unavailable/rate-limited → 503 (do not retry into an IP ban).
 */
export const nutritionBarcodeResolveHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(FoodService)
  .post(
    "/nutrition/barcode/resolve",
    async (ctx) => {
      getUser(ctx); // assert authed
      const { code } = ctx.body;

      const cached = await ctx.FoodRepository.getByBarcode(code);
      if (cached) return { data: cached };

      let result;
      try {
        result = await resolveBarcodeFromOFF(code);
      } catch (e) {
        if (e instanceof OpenFoodFactsUnavailableError) {
          ctx.set.status = 503;
          return { error: "food_db_unavailable" };
        }
        throw e;
      }

      if (!result.found) {
        ctx.set.status = 404;
        return { error: "barcode_not_found" };
      }

      // Idempotent upsert on the `barcode` UNIQUE rather than a bare INSERT:
      // two concurrent cache-misses for the same code (multiple users / a
      // fan-out) would both INSERT and the second would hit a 23505 → 500.
      // upsert-on-conflict + re-read is race-safe. Review fix (PR #124).
      await ctx.FoodRepository.upsertManyFromOff([
        { ...result.food, source: "openfoodfacts" },
      ]);
      const food = await ctx.FoodRepository.getByBarcode(code);
      if (!food) {
        ctx.set.status = 503;
        return { error: "food_db_unavailable" };
      }
      return { data: food };
    },
    {
      body: t.Object({ code: t.String({ minLength: 1 }) }),
    },
  );
