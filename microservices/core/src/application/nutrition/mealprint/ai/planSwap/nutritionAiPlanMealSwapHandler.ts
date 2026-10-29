import Elysia, { t } from "elysia";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import {
  assertEntitlement,
  EntitlementError,
} from "../../../../entitlement/assertEntitlement";
import { AiUsageLogService } from "../../../../repositories/aiUsageLogService";
import { NutritionTargetService } from "../../../../repositories/nutritionTargetService";
import { NutritionPreferenceService } from "../../../../repositories/nutritionPreferenceService";
import { MealprintCandidateService } from "../../../../repositories/mealprintCandidateService";
import {
  AiUnavailableError,
  AiUnreadableError,
  PREFILL_ALLOWANCE_MS,
  ROUTE_TIMEOUT_MS,
} from "../../../services/aiBedrockClient";
import {
  assembleCandidates,
  describeAssembly,
} from "../../candidates/assembleCandidates";
import {
  forbiddenAllergenTags,
  forbiddenPatternAllergenTags,
  hasAllergenConstraint,
  assessAvoidance,
} from "../../safety/avoidanceFilter";
import { isSupportedLocale } from "../../preferences/vocabulary";
import type { MealprintCandidate } from "../../../../repositories/mealprintCandidateRepository";
import {
  composeDayPlan,
  MIN_USEFUL_PLAN_MS,
  minUsefulPlanTokens,
  planMaxTokens,
  PLAN_TIMEOUT_MS,
} from "../planModel";
import { assessCompositionPortion, maxMealKcal } from "../portionPolicy";

const ENDPOINT = "/nutrition/ai/plan-meal-swap";

/** 10/day (design § Cost). Fail-safe parse (#156 pattern). */
const parsedSwapLimit = Number(process.env.AI_MEAL_SWAP_DAILY_LIMIT);
const AI_MEAL_SWAP_DAILY_LIMIT =
  Number.isFinite(parsedSwapLimit) && parsedSwapLimit > 0
    ? parsedSwapLimit
    : 10;

const POST_MODEL_RESERVE_MS = 3_500;

/** A single swapped meal should not alone exceed the whole day. */
const DEFAULT_MAX_SERVING_FRACTION = 1;

/**
 * POST /nutrition/ai/plan-meal-swap — regenerate ONE meal, holding the rest
 * (spec-26 AC 4.4). Stateless and STATELESS-BY-DESIGN: the client sends the
 * day target and the macros of the meals it is HOLDING, and the server composes
 * a single replacement to fit what remains. Nothing is read or written server-
 * side — which is why one endpoint serves both the pre-accept draft (holding the
 * other draft meals) and the post-accept edit (holding the other saved meals).
 *
 * ⚠ **The client supplies the held-meal macros; the server does not re-read a
 * stored plan here.** That is deliberate: a swap during draft review has no
 * stored plan to read, and forcing a persisted draft just to swap a meal would
 * add a write to a pre-accept flow the whole pipeline keeps stateless. The macros
 * the client holds are its own previously-verified figures; the ONE new meal is
 * fully re-verified here, so nothing unsafe can enter through the held totals —
 * they only shift the target the new meal aims at.
 *
 *   1. auth → 401  ·  2. meal_ai → 402  ·  3. ceiling → 429
 *   4. remaining budget usable → 200 empty  ·  5. candidates → 200 empty
 *   6. compose ONE meal → recompute + avoidance re-run → response
 */
export const nutritionAiPlanMealSwapHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(AiUsageLogService)
  .use(NutritionTargetService)
  .use(NutritionPreferenceService)
  .use(MealprintCandidateService)
  .post(
    "/nutrition/ai/plan-meal-swap",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const startedAt = Date.now();
      const requestSizeBytes = Buffer.byteLength(JSON.stringify(ctx.body));
      let responseSizeBytes: number | null = null;
      let reachedModel = false;

      try {
        const verdict = await assertEntitlement(userId, "meal_ai");
        if (!verdict.allowed) {
          throw new EntitlementError(verdict, "meal_ai");
        }

        const usedToday = await ctx.AiUsageLogRepository.countForUserToday(
          userId,
          ENDPOINT,
        );
        if (usedToday >= AI_MEAL_SWAP_DAILY_LIMIT) {
          ctx.set.status = 429;
          return { error: "ai_daily_limit" };
        }

        const preferences = await ctx.NutritionPreferenceRepository.get(userId);

        // The target the NEW meal aims at = the day target minus what is held.
        // Clamped at zero: a day already at target leaves nothing to compose.
        const { dayTarget, heldTotals, logSlot, steer } = ctx.body;
        const remaining = {
          kcal: Math.max(0, dayTarget.kcal - heldTotals.kcal),
          proteinG: Math.max(0, dayTarget.proteinG - heldTotals.proteinG),
          carbsG: Math.max(0, dayTarget.carbsG - heldTotals.carbsG),
          fatG: Math.max(0, dayTarget.fatG - heldTotals.fatG),
        };

        const respondEmpty = (
          emptyReason: "budget_exhausted" | "no_candidates",
          detail: string,
        ) => {
          const body = {
            data: {
              meal: null,
              emptyReason,
              labelCheckRequired: true,
            },
          };
          console.info(
            `[mealprint-swap] empty user=${userId} reason=${emptyReason} ${detail}`,
          );
          responseSizeBytes = Buffer.byteLength(JSON.stringify(body));
          return body;
        };

        // 4. Nothing left to fit — the held meals already meet the day.
        if (remaining.kcal < 50) {
          return respondEmpty(
            "budget_exhausted",
            `remainingKcal=${Math.round(remaining.kcal)}`,
          );
        }

        const locale = isSupportedLocale(preferences.locale)
          ? preferences.locale
          : "en-GB";
        const requireKnownAllergens = hasAllergenConstraint(preferences);
        const forbidden = [
          ...new Set([
            ...forbiddenAllergenTags(preferences.avoidAllergens),
            ...forbiddenPatternAllergenTags(preferences.dietaryPatterns),
          ]),
        ];
        const maxServingKcal = remaining.kcal * DEFAULT_MAX_SERVING_FRACTION;

        const [curated, ownFoods, ownRecipes, ownMeals] = await Promise.all([
          ctx.MealprintCandidateRepository.listCuratedCandidates({
            locale,
            maxServingKcal,
            forbiddenAllergenTags: forbidden,
            requireKnownAllergens,
          }),
          ctx.MealprintCandidateRepository.listOwnFoodCandidates(
            userId,
            maxServingKcal,
          ),
          ctx.MealprintCandidateRepository.listOwnRecipeCandidates(
            userId,
            maxServingKcal,
          ),
          ctx.MealprintCandidateRepository.listOwnMealCandidates(
            userId,
            maxServingKcal,
          ),
        ]);

        const assembly = assembleCandidates(
          [...ownFoods, ...ownRecipes, ...ownMeals, ...curated],
          preferences,
        );

        console.info(
          `[mealprint-swap] pool user=${userId} kept=${assembly.candidates.length} ${describeAssembly(assembly.stats)}`,
        );

        if (assembly.candidates.length === 0) {
          return respondEmpty(
            "no_candidates",
            describeAssembly(assembly.stats),
          );
        }

        const remainingMs =
          ROUTE_TIMEOUT_MS - (Date.now() - startedAt) - POST_MODEL_RESERVE_MS;
        const attemptMs = Math.min(PLAN_TIMEOUT_MS, remainingMs);
        const ceiling = planMaxTokens(attemptMs);
        if (
          attemptMs < PREFILL_ALLOWANCE_MS + MIN_USEFUL_PLAN_MS ||
          ceiling < minUsefulPlanTokens()
        ) {
          throw new AiUnavailableError(
            `ai_budget_exhausted: ${Math.max(0, attemptMs)}ms left after the preamble`,
          );
        }

        console.info(
          `[mealprint-swap] start user=${userId} slot=${logSlot} candidates=${assembly.candidates.length} attemptMs=${attemptMs}`,
        );

        reachedModel = true;
        const mealKcalCeiling = Math.min(
          remaining.kcal,
          maxMealKcal({
            dailyKcal: dayTarget.kcal,
            mealsPerDay: ctx.body.mealsPerDay ?? preferences.mealsPerDay,
            shape: logSlot === "snack" ? "snack" : undefined,
          }),
        );
        // Reuse the day composer with mealsPerDay = 1: one meal, fitting the
        // remaining budget. The prompt's "compose exactly 1 meal" is the swap.
        const result = await composeDayPlan(
          {
            target: remaining,
            mealsPerDay: 1,
            maxMealKcal: mealKcalCeiling,
            maxSnackKcal: mealKcalCeiling,
            steer: steer ?? null,
            candidates: assembly.candidates,
            likedFoods: preferences.likedFoods,
            effortLevel: preferences.effortLevel,
            locale,
          },
          { timeoutMs: attemptMs },
        );

        const chosen = result.meals[0];
        if (!chosen) {
          throw new AiUnreadableError("ai_no_meal: swap produced no meal");
        }

        // Recompute from DB rows + avoidance re-run (defence in depth).
        const byId = new Map<string, MealprintCandidate>(
          assembly.candidates.map((candidate) => [candidate.id, candidate]),
        );
        const portionFailure = assessCompositionPortion({
          items: chosen.items,
          candidates: byId,
          kcalCeiling: mealKcalCeiling,
        });
        if (portionFailure) {
          throw new AiUnreadableError(
            `ai_implausible_portion: ${portionFailure.detail}`,
          );
        }
        let kcal = 0;
        let proteinG = 0;
        let carbsG = 0;
        let fatG = 0;
        let containsUnverified = false;
        const items = chosen.items.map((item) => {
          const candidate = byId.get(item.candidateId)!;
          kcal += candidate.kcal * item.servings;
          proteinG += candidate.proteinG * item.servings;
          carbsG += candidate.carbsG * item.servings;
          fatG += candidate.fatG * item.servings;
          const avoidance = assessAvoidance(candidate, preferences);
          if (avoidance.allowed && avoidance.unverified)
            containsUnverified = true;
          return {
            candidateId: item.candidateId,
            kind: candidate.kind,
            servings: item.servings,
            name: candidate.name,
            kcal: candidate.kcal,
            proteinG: candidate.proteinG,
            carbsG: candidate.carbsG,
            fatG: candidate.fatG,
          };
        });

        const round = (n: number) => Math.round(n * 10) / 10;
        const body = {
          data: {
            meal: {
              name: chosen.name,
              reason: chosen.reason,
              // The swap keeps the SLOT the client asked to fill — the model's
              // own logSlot choice is irrelevant when replacing a specific meal.
              logSlot,
              items,
              kcal: round(kcal),
              proteinG: round(proteinG),
              carbsG: round(carbsG),
              fatG: round(fatG),
              containsUnverified,
            },
            emptyReason: null,
            labelCheckRequired: true,
          },
        };
        console.info(
          `[mealprint-swap] done user=${userId} model=${result.usage.modelId} kcal=${round(kcal)}`,
        );
        responseSizeBytes = Buffer.byteLength(JSON.stringify(body));
        return body;
      } catch (error) {
        if (error instanceof AiUnreadableError) {
          console.error(`[mealprint-swap] unreadable: ${error.message}`);
          ctx.set.status = 422;
          const body = { error: "ai_unreadable" };
          responseSizeBytes = Buffer.byteLength(JSON.stringify(body));
          return body;
        }
        if (error instanceof AiUnavailableError) {
          console.error(`[mealprint-swap] unavailable: ${error.message}`);
          ctx.set.status = 503;
          const body = { error: "ai_unavailable" };
          responseSizeBytes = Buffer.byteLength(JSON.stringify(body));
          return body;
        }
        throw error;
      } finally {
        try {
          if (reachedModel) {
            await ctx.AiUsageLogRepository.record({
              userId,
              endpoint: ENDPOINT,
              requestSizeBytes,
              responseSizeBytes,
              ms: Date.now() - startedAt,
            });
          }
        } catch (logError) {
          console.error(
            `[ai-usage-log] failed to record ${ENDPOINT}: ${
              logError instanceof Error ? logError.message : String(logError)
            }`,
          );
        }
      }
    },
    {
      body: t.Object({
        dayTarget: t.Object({
          kcal: t.Number({ minimum: 0 }),
          proteinG: t.Number({ minimum: 0 }),
          carbsG: t.Number({ minimum: 0 }),
          fatG: t.Number({ minimum: 0 }),
        }),
        // Sum of the macros of the meals being HELD. Client-supplied — see the
        // handler docstring on why this is safe (the new meal is fully
        // re-verified; held totals only shift the target).
        heldTotals: t.Object({
          kcal: t.Number({ minimum: 0 }),
          proteinG: t.Number({ minimum: 0 }),
          carbsG: t.Number({ minimum: 0 }),
          fatG: t.Number({ minimum: 0 }),
        }),
        logSlot: t.Union([
          t.Literal("breakfast"),
          t.Literal("lunch"),
          t.Literal("snack"),
          t.Literal("dinner"),
        ]),
        // Optional for deployed-client compatibility; current drafts and saved
        // plans always send the count used to derive their original ceiling.
        mealsPerDay: t.Optional(t.Integer({ minimum: 2, maximum: 6 })),
        steer: t.Optional(t.String({ maxLength: 200 })),
      }),
    },
  );
