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

const ENDPOINT = "/nutrition/ai/plan-generate";

/**
 * Daily ceiling — 5/day (design § Cost). Fail-safe parse (#156 pattern): a
 * mis-set env var must not silently disable the guard.
 */
const parsedPlanLimit = Number(process.env.AI_MEAL_PLAN_DAILY_LIMIT);
const AI_MEAL_PLAN_DAILY_LIMIT =
  Number.isFinite(parsedPlanLimit) && parsedPlanLimit > 0 ? parsedPlanLimit : 5;

/** See suggest's POST_MODEL_RESERVE_MS — usage-log INSERT + cold auth leg. */
const POST_MODEL_RESERVE_MS = 3_500;

/** Day-total tolerance (design § 1 stage 3): ±7% kcal, ±10% per macro. */
const KCAL_TOLERANCE = 0.07;
const MACRO_TOLERANCE = 0.1;

interface VerifiedPlanMeal {
  name: string;
  reason: string;
  logSlot: string;
  items: Array<{
    candidateId: string;
    kind: MealprintCandidate["kind"];
    servings: number;
    name: string;
    /** Per ONE serving — the mobile draft multiplies by `servings` itself. */
    kcal: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
  }>;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  /** TRUE when this meal contains a candidate with UNKNOWN allergen content. */
  containsUnverified: boolean;
  /**
   * TRUE when a resolved item FAILED the stage-3 avoidance re-run (an
   * `allowed: false` verdict). The draft-confirm UI surfaces this so the user
   * swaps the meal; the accept path independently 422s on the same condition.
   *
   * ⚠ This should be unreachable in practice — `assembleCandidates` already ran
   * the same `partitionByAvoidance` over the same candidate objects, so a pooled
   * candidate cannot come back `allowed: false` here. It exists so that if the
   * pool filter and this re-run ever DIVERGE (a bug), the failure surfaces as a
   * flagged meal rather than silently passing — i.e. the gate the header comment
   * promises is a real gate, not a no-op.
   */
  flaggedUnsafe: boolean;
  /** TRUE when the model exceeded an item or one-plate portion ceiling. */
  flaggedPortion: boolean;
}

/**
 * POST /nutrition/ai/plan-generate — compose a DAY PLAN draft (spec-26 AC 4.1,
 * 4.2, 4.6). Stateless: returns a draft payload and persists NOTHING, exactly
 * like `meal-suggest`. Acceptance is a separate `POST /nutrition/plans` call
 * that re-verifies and recomputes before it writes.
 *
 * ## Guard order (identical philosophy to suggest)
 *
 *   1. auth                                     → 401
 *   2. `meal_ai` entitlement                    → 402 (hard Premium+ gate)
 *   3. daily ceiling                            → 429
 *   4. targets exist                            → 200 empty (no_targets)
 *   5. candidate assembly (deterministic)       → 200 empty (no_candidates)
 *   6. model → per-meal recompute + avoidance re-run → response with flags
 *
 * ⚠ **The candidate pool is built against the FULL daily target**, not
 * remaining-today: a plan is composed from scratch for the whole day. A single
 * serving that alone exceeds the day's calories is noise, so `maxServingKcal` is
 * the daily target — the same "one item can't blow the budget" rule suggest
 * applies to the remaining budget.
 *
 * ⚠ **A meal that fails the post-model avoidance re-run is FLAGGED, not dropped**
 * (design § 1 stage 3: "failing meal returned flagged (plan) or dropped
 * (suggest)"). A day plan with a silent hole is worse than one that surfaces "we
 * couldn't make meal 3 safe — regenerate it": the mobile draft-confirm renders
 * the flag and the user swaps that meal. Dropping it would hand back a 3-meal
 * plan when 4 were asked for, with no explanation.
 */
export const nutritionAiPlanGenerateHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(AiUsageLogService)
  .use(NutritionTargetService)
  .use(NutritionPreferenceService)
  .use(MealprintCandidateService)
  .post(
    "/nutrition/ai/plan-generate",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const startedAt = Date.now();
      const requestSizeBytes = Buffer.byteLength(JSON.stringify(ctx.body));
      let responseSizeBytes: number | null = null;
      let reachedModel = false;

      try {
        // 2. Entitlement.
        const verdict = await assertEntitlement(userId, "meal_ai");
        if (!verdict.allowed) {
          throw new EntitlementError(verdict, "meal_ai");
        }

        // 3. Daily ceiling. Same best-effort-under-concurrency contract as the
        //    other AI endpoints (counted rows commit post-inference).
        const usedToday = await ctx.AiUsageLogRepository.countForUserToday(
          userId,
          ENDPOINT,
        );
        if (usedToday >= AI_MEAL_PLAN_DAILY_LIMIT) {
          ctx.set.status = 429;
          return { error: "ai_daily_limit" };
        }

        const [target, preferences] = await Promise.all([
          ctx.NutritionTargetRepository.get(userId),
          ctx.NutritionPreferenceRepository.get(userId),
        ]);
        const mealsPerDay = ctx.body.mealsPerDay ?? preferences.mealsPerDay;

        const respondEmpty = (
          emptyReason: "no_targets" | "no_candidates",
          detail: string,
        ) => {
          const body = {
            data: {
              meals: [],
              mealsPerDay,
              emptyReason,
              target: null,
              totals: null,
              withinTolerance: false,
              labelCheckRequired: true,
            },
          };
          console.info(
            `[mealprint-plan] empty user=${userId} reason=${emptyReason} ${detail}`,
          );
          responseSizeBytes = Buffer.byteLength(JSON.stringify(body));
          return body;
        };

        // 4. No targets → nothing to plan against.
        if (!target) {
          return respondEmpty("no_targets", "target=null");
        }

        // A plan uses the user's configured meal count unless the request
        // overrides it (both bounded 2–6 by the schema).
        const effortLevel = ctx.body.effortLevel ?? preferences.effortLevel;
        const steer = ctx.body.steer ?? null;

        // 5. Candidate assembly against the FULL daily target.
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

        const [curated, ownFoods, ownRecipes, ownMeals] = await Promise.all([
          ctx.MealprintCandidateRepository.listCuratedCandidates({
            locale,
            maxServingKcal: target.dailyKcal,
            forbiddenAllergenTags: forbidden,
            requireKnownAllergens,
          }),
          ctx.MealprintCandidateRepository.listOwnFoodCandidates(
            userId,
            target.dailyKcal,
          ),
          ctx.MealprintCandidateRepository.listOwnRecipeCandidates(
            userId,
            target.dailyKcal,
          ),
          ctx.MealprintCandidateRepository.listOwnMealCandidates(
            userId,
            target.dailyKcal,
          ),
        ]);

        const assembly = assembleCandidates(
          [...ownFoods, ...ownRecipes, ...ownMeals, ...curated],
          preferences,
        );

        console.info(
          `[mealprint-plan] pool user=${userId} kept=${assembly.candidates.length} ${describeAssembly(assembly.stats)}`,
        );

        if (assembly.candidates.length === 0) {
          return respondEmpty(
            "no_candidates",
            describeAssembly(assembly.stats),
          );
        }

        // 6. Model call, bounded by what is LEFT of the route budget.
        const remainingMs =
          ROUTE_TIMEOUT_MS - (Date.now() - startedAt) - POST_MODEL_RESERVE_MS;
        const attemptMs = Math.min(PLAN_TIMEOUT_MS, remainingMs);

        const ceiling = planMaxTokens(attemptMs);
        if (
          attemptMs < PREFILL_ALLOWANCE_MS + MIN_USEFUL_PLAN_MS ||
          ceiling < minUsefulPlanTokens()
        ) {
          console.warn(
            `[mealprint-plan] skipped user=${userId} attemptMs=${attemptMs} ceiling=${ceiling}`,
          );
          throw new AiUnavailableError(
            `ai_budget_exhausted: ${Math.max(0, attemptMs)}ms left after the preamble`,
          );
        }

        console.info(
          `[mealprint-plan] start user=${userId} meals=${mealsPerDay} candidates=${assembly.candidates.length} attemptMs=${attemptMs}`,
        );

        reachedModel = true;
        const mealKcalCeiling = maxMealKcal({
          dailyKcal: target.dailyKcal,
          mealsPerDay,
        });
        const snackKcalCeiling = maxMealKcal({
          dailyKcal: target.dailyKcal,
          mealsPerDay,
          shape: "snack",
        });
        const result = await composeDayPlan(
          {
            target: {
              kcal: target.dailyKcal,
              proteinG: target.proteinG,
              carbsG: target.carbsG,
              fatG: target.fatG,
            },
            mealsPerDay,
            maxMealKcal: mealKcalCeiling,
            maxSnackKcal: snackKcalCeiling,
            steer,
            candidates: assembly.candidates,
            likedFoods: preferences.likedFoods,
            effortLevel,
            locale,
          },
          { timeoutMs: attemptMs },
        );

        // Stage 3 — recompute every macro from the candidate rows handed to the
        // model, and re-run avoidance per item (defence in depth). The model's
        // numbers are never trusted; membership was already enforced in
        // composeDayPlan, so every id here is present in `byId`.
        const byId = new Map<string, MealprintCandidate>(
          assembly.candidates.map((candidate) => [candidate.id, candidate]),
        );

        const verifiedMeals: VerifiedPlanMeal[] = result.meals.map((meal) => {
          let kcal = 0;
          let proteinG = 0;
          let carbsG = 0;
          let fatG = 0;
          let containsUnverified = false;
          let flaggedUnsafe = false;
          const portionFailure = assessCompositionPortion({
            items: meal.items,
            candidates: byId,
            kcalCeiling:
              meal.logSlot === "snack" ? snackKcalCeiling : mealKcalCeiling,
          });
          const flaggedPortion = portionFailure !== null;

          const items = meal.items.map((item) => {
            const candidate = byId.get(item.candidateId)!;
            kcal += candidate.kcal * item.servings;
            proteinG += candidate.proteinG * item.servings;
            carbsG += candidate.carbsG * item.servings;
            fatG += candidate.fatG * item.servings;
            // Defence in depth (design § 1 stage 3): re-run avoidance on each
            // resolved item. An `allowed: true` verdict can still carry
            // `unverified` when the row's allergen content is unknown; an
            // `allowed: false` verdict means the item breaches an avoidance rule
            // and the whole meal is flagged for the user to swap (design § 1:
            // "failing meal returned flagged"). Should not happen — the pool was
            // already filtered — but flagging is what keeps this a real gate.
            const avoidance = assessAvoidance(candidate, preferences);
            if (!avoidance.allowed) {
              flaggedUnsafe = true;
              console.warn(
                `[mealprint-plan] stage-3 avoidance rejected a POOLED candidate user=${userId} candidate=${candidate.id} rule=${avoidance.rule} — pool filter and re-run have diverged`,
              );
            } else if (avoidance.unverified) {
              containsUnverified = true;
            }
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
          return {
            name: meal.name,
            reason: meal.reason,
            logSlot: meal.logSlot,
            items,
            kcal: round(kcal),
            proteinG: round(proteinG),
            carbsG: round(carbsG),
            fatG: round(fatG),
            containsUnverified,
            flaggedUnsafe,
            flaggedPortion,
          };
        });

        const totals = verifiedMeals.reduce(
          (acc, meal) => ({
            kcal: acc.kcal + meal.kcal,
            proteinG: acc.proteinG + meal.proteinG,
            carbsG: acc.carbsG + meal.carbsG,
            fatG: acc.fatG + meal.fatG,
          }),
          { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
        );

        const within = (actual: number, want: number, tol: number) =>
          want <= 0 ? true : Math.abs(actual - want) <= want * tol;
        const withinTolerance =
          within(totals.kcal, target.dailyKcal, KCAL_TOLERANCE) &&
          within(totals.proteinG, target.proteinG, MACRO_TOLERANCE) &&
          within(totals.carbsG, target.carbsG, MACRO_TOLERANCE) &&
          within(totals.fatG, target.fatG, MACRO_TOLERANCE);

        console.info(
          `[mealprint-plan] done user=${userId} model=${result.usage.modelId} latencyMs=${result.usage.latencyMs} meals=${verifiedMeals.length} kcal=${Math.round(totals.kcal)}/${target.dailyKcal} within=${withinTolerance}`,
        );

        const body = {
          data: {
            meals: verifiedMeals,
            mealsPerDay,
            emptyReason: null,
            target: {
              kcal: target.dailyKcal,
              proteinG: target.proteinG,
              carbsG: target.carbsG,
              fatG: target.fatG,
            },
            totals: {
              kcal: Math.round(totals.kcal * 10) / 10,
              proteinG: Math.round(totals.proteinG * 10) / 10,
              carbsG: Math.round(totals.carbsG * 10) / 10,
              fatG: Math.round(totals.fatG * 10) / 10,
            },
            // A hint for the draft-confirm UI, NOT a gate — the user can accept a
            // plan that misses tolerance, and the accept path does not enforce it.
            withinTolerance,
            // Always true — same unconditional label-check contract as suggest.
            labelCheckRequired: true,
          },
        };
        responseSizeBytes = Buffer.byteLength(JSON.stringify(body));
        return body;
      } catch (error) {
        if (error instanceof AiUnreadableError) {
          console.error(`[mealprint-plan] unreadable: ${error.message}`);
          ctx.set.status = 422;
          const body = { error: "ai_unreadable" };
          responseSizeBytes = Buffer.byteLength(JSON.stringify(body));
          return body;
        }
        if (error instanceof AiUnavailableError) {
          console.error(`[mealprint-plan] unavailable: ${error.message}`);
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
        // The day this plan is for — used by the client on accept; the generate
        // step itself does not need it, but carrying it keeps the draft
        // self-describing.
        planDate: t.Optional(t.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" })),
        mealsPerDay: t.Optional(t.Integer({ minimum: 2, maximum: 6 })),
        effortLevel: t.Optional(
          t.Union([
            t.Literal("quick"),
            t.Literal("balanced"),
            t.Literal("high_maintenance"),
          ]),
        ),
        steer: t.Optional(t.String({ maxLength: 200 })),
      }),
    },
  );
