import Elysia, { t } from "elysia";
import { NutritionPreferenceService } from "../../../../repositories/nutritionPreferenceService";
import { PreferenceValidationError } from "../../../../repositories/nutritionPreferenceRepository";
import {
  AVOID_ALLERGENS,
  DIETARY_PATTERNS,
  EFFORT_LEVELS,
  SUPPORTED_LOCALES,
} from "../vocabulary";
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
 * PUT /nutrition/preferences — upsert the caller's Mealprint food preferences
 * (spec-26 AC 1.3).
 *
 * Entitlement-gated as part of Mealprint product access. The row is retained on
 * lapse and becomes editable again after resubscription.
 *
 * ## Validation happens in three places, none of them redundant
 *
 *   1. **Here, in the Elysia schema** — closed vocabularies as `t.Union` of
 *      literals built FROM the vocabulary module, so an unknown chip is rejected
 *      at the edge with the field named, and the wire contract in
 *      `packages/web`'s Eden client narrows to the real union rather than
 *      `string`.
 *   2. **`validatePreferenceInput`** — the same checks plus normalisation and
 *      the free-text caps, so any future caller (a script, a coach-on-behalf
 *      route) gets them without depending on this schema.
 *   3. **DB CHECK constraints** — the backstop.
 *
 * The reason to keep all three: a pattern stored without a matching rule in
 * `DIETARY_PATTERN_RULES` is silently ignored at generation time, so the user
 * picks "vegan" and is served meat. That failure is invisible, which is why it
 * gets three gates rather than one.
 */
export const nutritionPreferencesSetHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(NutritionPreferenceService)
  .put(
    "/nutrition/preferences",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const verdict = await assertEntitlement(userId, "meal_ai");
      if (!verdict.allowed) throw new EntitlementError(verdict, "meal_ai");
      try {
        const preferences = await ctx.NutritionPreferenceRepository.upsert(
          userId,
          {
            dietaryPatterns: [...ctx.body.dietaryPatterns],
            avoidAllergens: [...ctx.body.avoidAllergens],
            avoidFoods: [...ctx.body.avoidFoods],
            likedFoods: [...ctx.body.likedFoods],
            mealsPerDay: ctx.body.mealsPerDay,
            effortLevel: ctx.body.effortLevel,
            locale: ctx.body.locale,
          },
        );
        return { data: preferences };
      } catch (error) {
        if (error instanceof PreferenceValidationError) {
          // 400 with the field and value named. Reachable despite the schema
          // above for the checks the schema cannot express — the free-text
          // length and count caps.
          ctx.set.status = 400;
          return {
            code: "INVALID_PREFERENCE",
            field: error.field,
            value: error.value,
            message: error.message,
          };
        }
        throw error;
      }
    },
    {
      body: t.Object({
        // Built from the vocabulary arrays so adding a key in one place cannot
        // leave the wire schema behind. `t.Union` of `t.Literal`s (rather than
        // `t.String`) is what makes the Eden type in packages/web narrow.
        dietaryPatterns: t.Array(
          t.Union(DIETARY_PATTERNS.map((p) => t.Literal(p))),
          { maxItems: DIETARY_PATTERNS.length },
        ),
        avoidAllergens: t.Array(
          t.Union(AVOID_ALLERGENS.map((a) => t.Literal(a))),
          { maxItems: AVOID_ALLERGENS.length },
        ),
        // Bounds duplicated from `MAX_FREE_TEXT_*` deliberately: rejecting an
        // oversized body at the edge avoids parsing a megabyte of dislikes into
        // the Lambda before the repository refuses it.
        avoidFoods: t.Array(t.String({ maxLength: 120 }), { maxItems: 60 }),
        likedFoods: t.Array(t.String({ maxLength: 120 }), { maxItems: 60 }),
        mealsPerDay: t.Integer({ minimum: 2, maximum: 6 }),
        effortLevel: t.Union(EFFORT_LEVELS.map((e) => t.Literal(e))),
        locale: t.Union(SUPPORTED_LOCALES.map((l) => t.Literal(l))),
      }),
    },
  );
