import Elysia from "elysia";
import { NutritionPreferenceService } from "../../../../repositories/nutritionPreferenceService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import {
  assertEntitlement,
  EntitlementError,
} from "../../../../entitlement/assertEntitlement";

/**
 * GET /nutrition/preferences — the caller's Mealprint food preferences
 * (spec-26 AC 1.3).
 *
 * ⚠ **404-free by design.** No row returns defaults. Product access is gated;
 * the account export path remains the way a lapsed user exercises data rights.
 *
 *   - No row → the defaults, with `isDefault: true`. Every Mealprint surface
 *     reads preferences unconditionally, so a 404 would push a "did you mean
 *     empty?" branch into every one of them.
 * Scoped to `getUser(ctx).sub` with no id parameter, so there is no shape in
 * which this reads another user's dietary data.
 */
export const nutritionPreferencesGetHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(NutritionPreferenceService)
  .get("/nutrition/preferences", async (ctx) => {
    const { sub: userId } = getUser(ctx);
    const verdict = await assertEntitlement(userId, "meal_ai");
    if (!verdict.allowed) throw new EntitlementError(verdict, "meal_ai");
    const preferences = await ctx.NutritionPreferenceRepository.get(userId);
    return { data: preferences };
  });
