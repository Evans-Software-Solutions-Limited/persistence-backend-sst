import Elysia, { t } from "elysia";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { MealPlanService } from "../../../../repositories/mealPlanService";
import { MealprintCandidateService } from "../../../../repositories/mealprintCandidateService";
import { NutritionPreferenceService } from "../../../../repositories/nutritionPreferenceService";
import { NutritionTargetService } from "../../../../repositories/nutritionTargetService";
import {
  ActivePlanExistsError,
  type CreatePlanMealInput,
  type LogSlot,
} from "../../../../repositories/mealPlanRepository";
import type { MealprintCandidate } from "../../../../repositories/mealprintCandidateRepository";
import { partitionByAvoidance } from "../../safety/avoidanceFilter";
import {
  assertEntitlement,
  EntitlementError,
} from "../../../../entitlement/assertEntitlement";
import { assessCompositionPortion, maxMealKcal } from "../../ai/portionPolicy";

/**
 * POST /nutrition/plans — ACCEPT a reviewed draft plan (spec-26 AC 4.5, 5.4).
 *
 * ## The whole point of this handler: the client sends REFERENCES, not numbers
 *
 * The request body carries ids and serving counts. It carries **no macros and no
 * food names**, and the route schema will reject them if they appear. Every
 * kcal/protein/carb/fat value written to `meal_plan_meals` is recomputed here
 * from `resolveByIds`, which reads the authoritative `foods`/`recipes`/`meals`
 * rows.
 *
 * That is not defensive plumbing, it is the feature's correctness model — spec-26
 * design § 1: _"Accuracy is a database property, not a model property."_ A draft
 * comes from a model, travels through a client, and may sit in an offline queue
 * for hours before arriving. Trusting any number on it would let a stale cache,
 * a replayed request or a tampered body store a 900-kcal meal as 300 and silently
 * corrupt the user's own adherence history.
 *
 * ## Guard order
 *
 *   1. auth                                        → 401
 *   2. every referenced id resolves                → 400 `unresolvable_items`
 *   3. avoidance re-run on the resolved rows       → 422 `avoidance_violation`
 *   4. portion policy still holds                  → 422 `portion_violation`
 *   5. targets snapshot resolvable                 → 400 `no_targets`
 *   6. insert (Postgres arbitrates the day slot)   → 409 `active_plan_exists`
 *
 * Accept is gated as well as generation: a draft generated before a downgrade
 * must not become durable after the entitlement has ended.
 *
 * ⚠ **Step 3 is a 422, not a filter.** Silently dropping a meal that fails
 * avoidance would hand back a plan quietly missing rows, which is worse than
 * refusing: a user with a nut allergy must never be left wondering whether the
 * plan they are looking at is the plan they approved. The one case that reaches
 * here is a draft generated before a preferences change, so the client's correct
 * response is to regenerate.
 */
export const nutritionPlansCreateHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(MealPlanService)
  .use(MealprintCandidateService)
  .use(NutritionPreferenceService)
  .use(NutritionTargetService)
  .post(
    "/nutrition/plans",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const verdict = await assertEntitlement(userId, "meal_ai");
      if (!verdict.allowed) throw new EntitlementError(verdict, "meal_ai");
      const { planDate, meals, groupId } = ctx.body;

      const [preferences, target] = await Promise.all([
        ctx.NutritionPreferenceRepository.get(userId),
        ctx.NutritionTargetRepository.get(userId),
      ]);
      const acceptedMealsPerDay =
        ctx.body.mealsPerDay ?? preferences.mealsPerDay;
      // The selected count may preserve a larger allocation after the user
      // removes a draft meal, but it may never claim FEWER slots than the body
      // actually contains to loosen the per-plate divisor.
      const enforcedMealsPerDay = Math.max(acceptedMealsPerDay, meals.length);

      // 4 (checked early — it is the cheapest reject and the snapshot is
      // mandatory). A plan with no target has nothing to be measured against,
      // and `meal_plans.target_*` are NOT NULL.
      if (!target) {
        ctx.set.status = 400;
        return { error: "no_targets" };
      }

      // 2. Resolve every referenced id in ONE round trip per kind.
      const foodIds = meals.flatMap((meal) =>
        (meal.items ?? []).map((item) => item.foodId),
      );
      const recipeIds = meals
        .map((meal) => meal.recipeId)
        .filter((id): id is string => typeof id === "string");
      const mealIds = meals
        .map((meal) => meal.mealId)
        .filter((id): id is string => typeof id === "string");

      const resolved = await ctx.MealprintCandidateRepository.resolveByIds(
        userId,
        { foodIds, recipeIds, mealIds },
      );

      const byKindId = new Map<string, MealprintCandidate>(
        resolved.map((candidate) => [
          `${candidate.kind}:${candidate.id}`,
          candidate,
        ]),
      );

      // ⚠ Reports EVERY missing id, not just the first. The client turns this
      // into "these items are no longer available", and a one-at-a-time reject
      // would make that a round trip per stale row.
      const missing: string[] = [];
      for (const meal of meals) {
        if (meal.recipeId && !byKindId.has(`recipe:${meal.recipeId}`)) {
          missing.push(`recipe:${meal.recipeId}`);
        }
        if (meal.mealId && !byKindId.has(`meal:${meal.mealId}`)) {
          missing.push(`meal:${meal.mealId}`);
        }
        for (const item of meal.items ?? []) {
          if (!byKindId.has(`food:${item.foodId}`)) {
            missing.push(`food:${item.foodId}`);
          }
        }
      }
      if (missing.length > 0) {
        console.warn(
          `[mealprint-plan-accept] unresolvable user=${userId} ids=${missing.join(",")}`,
        );
        ctx.set.status = 400;
        return { error: "unresolvable_items", items: [...new Set(missing)] };
      }

      // 3. Avoidance re-run against the resolved rows. The draft was filtered at
      //    generation time, but preferences can have changed since — and this is
      //    the last point before the plan becomes durable.
      const { rejected } = partitionByAvoidance(resolved, preferences);
      if (rejected.length > 0) {
        console.warn(
          `[mealprint-plan-accept] avoidance user=${userId} rejected=${rejected
            .map(
              (entry) =>
                `${entry.subject.kind}:${entry.subject.id}:${entry.verdict.rule}`,
            )
            .join(",")}`,
        );
        ctx.set.status = 422;
        return {
          error: "avoidance_violation",
          items: rejected.map((entry) => entry.subject.id),
        };
      }

      // 4. Generation flags implausible meals for a swap, but the durable
      // write must remain the final authority for stale or direct clients.
      // Reference-basis OFF rows describe nutrition per 100 g, not a declared
      // portion, so they are never valid AI-plan inputs.
      const referenceCandidate = resolved.find(
        (candidate) => candidate.servingBasis === "reference",
      );
      if (referenceCandidate) {
        ctx.set.status = 422;
        return {
          error: "portion_violation",
          detail: `${referenceCandidate.kind}:${referenceCandidate.id}:reference_serving`,
        };
      }

      for (const meal of meals) {
        const portionItems = [
          ...(meal.recipeId
            ? [
                {
                  candidateId: `recipe:${meal.recipeId}`,
                  servings: meal.servings ?? 1,
                },
              ]
            : []),
          ...(meal.mealId
            ? [
                {
                  candidateId: `meal:${meal.mealId}`,
                  servings: meal.servings ?? 1,
                },
              ]
            : []),
          ...(meal.items ?? []).map((item) => ({
            candidateId: `food:${item.foodId}`,
            servings: item.servings,
          })),
        ];
        const portionFailure = assessCompositionPortion({
          items: portionItems,
          candidates: byKindId,
          kcalCeiling: maxMealKcal({
            dailyKcal: target.dailyKcal,
            mealsPerDay: enforcedMealsPerDay,
            shape: meal.logSlot === "snack" ? "snack" : undefined,
          }),
        });
        if (portionFailure) {
          ctx.set.status = 422;
          return {
            error: "portion_violation",
            detail: portionFailure.detail,
          };
        }
      }

      // Recompute. A meal's macros are the sum of its resolved parts:
      //   - recipe/meal-backed → the resolved per-serving figure
      //   - item list          → Σ candidate macro × servings
      // ⚠ Both are summed rather than one taking precedence, because a composed
      // meal may legitimately be a recipe PLUS extra items (the schema allows
      // it — see the migration's note on why there is no XOR check).
      const planMeals: CreatePlanMealInput[] = meals.map((meal, index) => {
        let kcal = 0;
        let proteinG = 0;
        let carbsG = 0;
        let fatG = 0;

        const add = (candidate: MealprintCandidate, servings: number) => {
          kcal += candidate.kcal * servings;
          proteinG += candidate.proteinG * servings;
          carbsG += candidate.carbsG * servings;
          fatG += candidate.fatG * servings;
        };

        if (meal.recipeId) {
          add(byKindId.get(`recipe:${meal.recipeId}`)!, meal.servings ?? 1);
        }
        if (meal.mealId) {
          add(byKindId.get(`meal:${meal.mealId}`)!, meal.servings ?? 1);
        }
        for (const item of meal.items ?? []) {
          add(byKindId.get(`food:${item.foodId}`)!, item.servings);
        }

        return {
          // ⚠ Server-assigned, ignoring any client ordering hint. `sort_order`
          // is uniquely indexed per plan, so a client that sent duplicate
          // positions would 23505 on a constraint whose name means nothing to it.
          sortOrder: index,
          label: meal.label,
          logSlot: meal.logSlot as LogSlot,
          recipeId: meal.recipeId ?? null,
          mealId: meal.mealId ?? null,
          items: meal.items ?? null,
          // Rounded to one decimal: these are display-and-sum figures, and
          // carrying float noise into a numeric column makes every later total
          // look untrustworthy for no gain.
          kcal: Math.round(kcal * 10) / 10,
          proteinG: Math.round(proteinG * 10) / 10,
          carbsG: Math.round(carbsG * 10) / 10,
          fatG: Math.round(fatG * 10) / 10,
          aiReason: meal.aiReason ?? null,
        };
      });

      try {
        const plan = await ctx.MealPlanRepository.create(userId, {
          planDate,
          groupId: groupId ?? null,
          // Snapshots, taken here rather than read at display time.
          mealsPerDay: enforcedMealsPerDay,
          effortLevel: preferences.effortLevel,
          targetKcal: target.dailyKcal,
          targetProteinG: target.proteinG,
          targetCarbsG: target.carbsG,
          targetFatG: target.fatG,
          meals: planMeals,
        });

        console.info(
          `[mealprint-plan-accept] created user=${userId} plan=${plan.id} date=${planDate} meals=${plan.meals.length}`,
        );
        return { data: plan };
      } catch (error) {
        if (error instanceof ActivePlanExistsError) {
          // 409, not 500: the client can offer "replace today's plan", which is
          // an archive-then-retry it already has endpoints for.
          ctx.set.status = 409;
          return { error: "active_plan_exists", planDate: error.planDate };
        }
        throw error;
      }
    },
    {
      body: t.Object({
        planDate: t.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
        // Phase 3 week plans supply a shared group id. Optional so a day plan
        // does not have to invent one.
        groupId: t.Optional(t.String({ format: "uuid" })),
        // Optional only for compatibility with already-deployed clients.
        // Current generated drafts return and preserve this exact count.
        mealsPerDay: t.Optional(t.Integer({ minimum: 2, maximum: 6 })),
        meals: t.Array(
          t.Object({
            label: t.String({ minLength: 1, maxLength: 120 }),
            logSlot: t.Union([
              t.Literal("breakfast"),
              t.Literal("lunch"),
              t.Literal("snack"),
              t.Literal("dinner"),
            ]),
            recipeId: t.Optional(t.String({ format: "uuid" })),
            mealId: t.Optional(t.String({ format: "uuid" })),
            /** Multiplier for a recipe/meal-backed row. Items carry their own. */
            servings: t.Optional(t.Number({ minimum: 0.1, maximum: 20 })),
            items: t.Optional(
              t.Array(
                t.Object({
                  foodId: t.String({ format: "uuid" }),
                  servings: t.Number({ minimum: 0.1, maximum: 20 }),
                }),
                { maxItems: 30 },
              ),
            ),
            aiReason: t.Optional(t.String({ maxLength: 400 })),
          }),
          // ⚠ NOTE WHAT IS ABSENT: no kcal/proteinG/carbsG/fatG. Elysia strips
          // unknown properties, so a client that sends macros has them
          // discarded rather than honoured — the schema is the enforcement, not
          // just documentation. Bounded at the same six-meal ceiling as
          // preferences, which also bounds the resolve fan-out.
          { minItems: 1, maxItems: 6 },
        ),
      }),
    },
  );
