import Elysia from "elysia";
import { NutritionPreferenceService } from "../../../../repositories/nutritionPreferenceService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/**
 * GET /nutrition/preferences — the caller's Mealprint food preferences
 * (spec-26 AC 1.3).
 *
 * ⚠ **404-free by design, and NOT entitlement-gated.** Two deliberate choices:
 *
 *   - No row → the defaults, with `isDefault: true`. Every Mealprint surface
 *     reads preferences unconditionally, so a 404 would push a "did you mean
 *     empty?" branch into every one of them.
 *   - No `meal_ai` gate. Preferences are USER DATA, not the paid feature — the
 *     paywall sits on generation. Gating the read would mean an expired
 *     subscriber could not see, correct or export the allergen list they
 *     entered, which is both hostile and a GDPR access problem. The mobile
 *     editor is reachable from Fuel Targets independently of Mealprint for the
 *     same reason.
 *
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
    const preferences = await ctx.NutritionPreferenceRepository.get(userId);
    return { data: preferences };
  });
