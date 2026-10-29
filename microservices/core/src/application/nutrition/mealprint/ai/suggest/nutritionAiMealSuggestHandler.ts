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
import { NutritionEntryService } from "../../../../repositories/nutritionEntryService";
import { NutritionTargetService } from "../../../../repositories/nutritionTargetService";
import { NutritionPreferenceService } from "../../../../repositories/nutritionPreferenceService";
import { MealprintCandidateService } from "../../../../repositories/mealprintCandidateService";
import {
  AiUnavailableError,
  AiUnreadableError,
  maxTokensForBudget,
  PREFILL_ALLOWANCE_MS,
  ROUTE_TIMEOUT_MS,
} from "../../../services/aiBedrockClient";
import { summariseConsumed } from "../../../today/nutritionTodayHandler";
import {
  assembleCandidates,
  describeAssembly,
} from "../../candidates/assembleCandidates";
import {
  forbiddenAllergenTags,
  forbiddenPatternAllergenTags,
  hasAllergenConstraint,
} from "../../safety/avoidanceFilter";
import { isSupportedLocale } from "../../preferences/vocabulary";
import {
  composeSuggestions,
  MIN_USEFUL_GENERATION_MS,
  minUsefulSuggestTokens,
  SUGGEST_TIMEOUT_MS,
  suggestMaxTokens,
  type SuggestOccasion,
  type SuggestShape,
} from "../suggestModel";
import {
  describeVerification,
  MIN_USEFUL_REMAINING_KCAL,
  verifySuggestions,
} from "../verifyComposition";
import { maxCheatMealKcal, maxMealKcal } from "../portionPolicy";

const ENDPOINT = "/nutrition/ai/meal-suggest";

/**
 * Daily per-user ceiling — **20/day, locked by Brad 2026-07-24** (requirements
 * checkpoint 3). Not provisional.
 *
 * At the Haiku-class cost design § Cost derives (~£0.006 per suggest), 20/day
 * fully consumed is ~£3.60/month against £29.99 — abuse control, not unit
 * economics, which is what argued for a generous number: the bad failure is a
 * real athlete hitting the cap while deciding what to eat.
 *
 * Fail-safe parse (#156 pattern): a mis-set env var must not silently disable
 * the guard, so anything non-finite or non-positive falls back to the default.
 */
const parsedSuggestLimit = Number(process.env.AI_MEAL_SUGGEST_DAILY_LIMIT);
const AI_MEAL_SUGGEST_DAILY_LIMIT =
  Number.isFinite(parsedSuggestLimit) && parsedSuggestLimit > 0
    ? parsedSuggestLimit
    : 20;

/**
 * Reserve for everything that happens AFTER the model call inside the route
 * budget: the usage-log INSERT, and — on a cold instance — the unmeasured auth
 * leg that ran in `.derive` before `startedAt` was set (a `createRemoteJWKSet`
 * fetch plus a TLS handshake). Both costs are correlated because both are cold.
 * Sized from Loadout's measured 3.5 s.
 */
const POST_MODEL_RESERVE_MS = 3_500;

/**
 * POST /nutrition/ai/meal-suggest — "what can I eat with what I have left
 * today?" (spec-26 STORY-003, AC 3.3/3.4/3.6).
 *
 * ## Guard order (deliberate)
 *
 *   1. auth                                           → 401
 *   2. `meal_ai` entitlement                          → 402  (hard gate, no taster)
 *   3. daily ceiling                                  → 429
 *   4. remaining budget is usable                     → 200 with an empty result
 *   5. candidate assembly (deterministic)             → 200 with an empty result
 *   6. model → verification → response
 *
 * ⚠ **The entitlement sits ABOVE everything, including the reads.** Unlike
 * Loadout's preview — which reads the parent workout first so a caller poking at
 * someone else's workout gets a 404 rather than a 402 that confirms it exists —
 * there is no other user's resource in this request. Every read is the caller's
 * own, so there is nothing to leak by ordering the paywall first, and an
 * unentitled caller should not get free use of the pipeline's reads.
 *
 * ## Steps 4 and 5 are 200s, not errors, and that is the interesting decision
 *
 * "You have 40 kcal left" and "your restrictions exclude everything we have" are
 * both legitimate ANSWERS, not failures. Returning 422 would make the client
 * render a generic error for a state it can explain precisely, and — with the tag
 * backfill outstanding (`20260803120000_foods_mealprint_tags.sql`) — the empty
 * pool is the EXPECTED early state for any user with an allergen chip set. So the
 * response carries a machine-readable `emptyReason` and neither case consumes the
 * daily ceiling or writes a usage row, because neither reached the model.
 *
 * ## No fallback when Bedrock is down
 *
 * A model failure is a 503. There is no deterministic "here are three
 * high-protein foods" fallback, for the same reason Loadout refuses one: shipping
 * mechanically-assembled output under a Premium+ badge is worse product than a
 * visible outage.
 *
 * ## `occasion` (amendment 2026-08 § A) — SCOPE NOTE
 *
 * `on_plan` / `cheat_meal` / `eating_out` change the count, per-card
 * `tag`/`cheat`/`isOrder` semantics, and — for `cheat_meal`'s "Have it" card
 * only — relax the budget ceiling (decision 1, implemented below and in
 * `verifyComposition`). The candidate-constrained contract (design § 1 rule 1)
 * is UNCHANGED for all three occasions in this slice: every item still resolves
 * to a real DB candidate with server-recomputed macros.
 *
 * The amendment's decision 2 additionally describes `eating_out` as
 * "AI-estimated, not candidate-constrained" — i.e. the model naming real,
 * off-catalogue restaurant dishes with its own macro estimates. That is a
 * materially larger change (a parallel item schema, a verification path that
 * does not recompute macros from a DB row) than anything in this backend's
 * explicit task scope, so it has been left UNIMPLEMENTED here rather than
 * guessed at. What IS implemented: `eating_out` suggestions still draw from the
 * same candidate pool as every other occasion, tagged `isOrder: true` with
 * `tag: "Meal" | "Snack"`, and the response is unconditionally forced
 * `containsUnverified: true` for those cards (`verifyComposition`) — on top of
 * the `labelCheckRequired: true` this route already sends unconditionally for
 * every occasion. Flag this to Brad before shipping the full off-catalogue
 * allowance.
 */
export const nutritionAiMealSuggestHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(AiUsageLogService)
  .use(NutritionEntryService)
  .use(NutritionTargetService)
  .use(NutritionPreferenceService)
  .use(MealprintCandidateService)
  .post(
    "/nutrition/ai/meal-suggest",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const startedAt = Date.now();
      const requestSizeBytes = Buffer.byteLength(JSON.stringify(ctx.body));
      let responseSizeBytes: number | null = null;
      // Usage rows record ACTUAL inferences (success, 422, 503) — never
      // pre-model exits (402/429, empty budget, empty pool), which cost nothing
      // and must not consume the ceiling.
      let reachedModel = false;

      try {
        // 2. Entitlement — hard Premium+ gate, no taster (decision 2).
        const verdict = await assertEntitlement(userId, "meal_ai");
        if (!verdict.allowed) {
          throw new EntitlementError(verdict, "meal_ai");
        }

        // 3. Daily ceiling. Best-effort under concurrency (counted rows commit
        //    post-inference), which is fine for a cost backstop and is the same
        //    contract all seven AI endpoints share — see STATE.md § "Daily AI
        //    ceilings are not concurrency-safe", deliberately unfixed here so
        //    this endpoint does not enforce a different contract from its
        //    siblings. The real fix belongs in `AiUsageLogRepository`.
        const usedToday = await ctx.AiUsageLogRepository.countForUserToday(
          userId,
          ENDPOINT,
        );
        if (usedToday >= AI_MEAL_SUGGEST_DAILY_LIMIT) {
          ctx.set.status = 429;
          return { error: "ai_daily_limit" };
        }

        const { shape, steer } = ctx.body;
        // Amendment 2026-08 § A.2: `occasion` defaults to `on_plan`, matching the
        // original single-occasion behaviour when a client omits it.
        const occasion: SuggestOccasion = ctx.body.occasion ?? "on_plan";
        const today = ctx.body.date;

        const [entries, target, preferences] = await Promise.all([
          ctx.NutritionEntryRepository.listByDate(userId, today),
          ctx.NutritionTargetRepository.get(userId),
          ctx.NutritionPreferenceRepository.get(userId),
        ]);

        const respondEmpty = (
          emptyReason: "no_targets" | "budget_exhausted" | "no_candidates",
          detail: string,
        ) => {
          const body = {
            data: {
              suggestions: [],
              emptyReason,
              remaining: null,
              containsUnverified: false,
              partialEnforcementOnly: false,
              labelCheckRequired: true,
            },
          };
          console.info(
            `[mealprint-suggest] empty user=${userId} reason=${emptyReason} ${detail}`,
          );
          responseSizeBytes = Buffer.byteLength(JSON.stringify(body));
          return body;
        };

        // 4a. No targets → nothing to fill. The Fuel Targets editor is the fix,
        //     and the client can say so precisely.
        if (!target) {
          return respondEmpty("no_targets", "target=null");
        }

        const consumed = summariseConsumed(entries);
        const remaining = {
          kcal: target.dailyKcal - consumed.kcal,
          // Macros clamp at zero: a negative remaining protein is "you have met
          // it", and feeding a negative number into the prompt would read as a
          // nonsensical target.
          proteinG: Math.max(0, target.proteinG - consumed.proteinG),
          carbsG: Math.max(0, target.carbsG - consumed.carbsG),
          fatG: Math.max(0, target.fatG - consumed.fatG),
        };

        // 4b. Budget exhausted. `MIN_USEFUL_REMAINING_KCAL` is the same floor the
        //     verifier uses, so the two layers agree on what "nothing left" means
        //     — otherwise this would spend an inference to have every suggestion
        //     rejected for overshoot.
        //
        // ⚠ SKIPPED for `cheat_meal` (amendment § A.3 decision 1). The whole
        //   point of the "Have it" card is that it is allowed to exceed the
        //   remaining budget — including when the budget is already exhausted —
        //   so "nothing left" is not itself a reason to refuse a cheat-meal
        //   request the way it is for every other occasion.
        if (
          occasion !== "cheat_meal" &&
          remaining.kcal < MIN_USEFUL_REMAINING_KCAL
        ) {
          return respondEmpty(
            "budget_exhausted",
            `remainingKcal=${Math.round(remaining.kcal)}`,
          );
        }

        // 5. Candidate assembly (stage 1). Deterministic, no model involved.
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

        // ⚠ Amendment § A.3 decision 1: the cheat-meal "Have it" card is meant to
        // be genuinely indulgent and MAY exceed the remaining budget. If
        // candidate assembly still ceilinged every query at `remaining.kcal`,
        // the model could never be OFFERED anything over budget in the first
        // place, and the "have it" card would be no different from any other
        // suggestion. A fixed, generous headroom (not `Infinity` — this value
        // is bound into a SQL numeric comparison) widens the pool for
        // `cheat_meal` only; every other occasion keeps the existing ceiling.
        const CHEAT_MEAL_KCAL_HEADROOM = 2000;
        const candidateKcalCeiling =
          occasion === "cheat_meal"
            ? remaining.kcal + CHEAT_MEAL_KCAL_HEADROOM
            : remaining.kcal;

        const [curated, ownFoods, ownRecipes, ownMeals] = await Promise.all([
          ctx.MealprintCandidateRepository.listCuratedCandidates({
            locale,
            maxServingKcal: candidateKcalCeiling,
            forbiddenAllergenTags: forbidden,
            requireKnownAllergens,
          }),
          ctx.MealprintCandidateRepository.listOwnFoodCandidates(
            userId,
            candidateKcalCeiling,
          ),
          // Same serving-kcal ceiling as the two foods queries. Without it a
          // library of 600-kcal batch-cooks filled the pool of a user with 250
          // kcal left, and the verifier rejected the lot for `kcal_overshoot` —
          // a 422 that burned a daily run for a knowable state.
          ctx.MealprintCandidateRepository.listOwnRecipeCandidates(
            userId,
            candidateKcalCeiling,
          ),
          ctx.MealprintCandidateRepository.listOwnMealCandidates(
            userId,
            candidateKcalCeiling,
          ),
        ]);

        const assembly = assembleCandidates(
          [...ownFoods, ...ownRecipes, ...ownMeals, ...curated],
          preferences,
        );

        // ⚠ Always logged, not only on failure. A thin-but-nonempty pool is the
        // hard case to diagnose, and the rule breakdown is what distinguishes
        // "the backfill has not run" from "this user really has excluded
        // everything".
        console.info(
          `[mealprint-suggest] pool user=${userId} kept=${assembly.candidates.length} ${describeAssembly(assembly.stats)}`,
        );

        if (assembly.candidates.length === 0) {
          return respondEmpty(
            "no_candidates",
            describeAssembly(assembly.stats),
          );
        }

        // 6. Model call, bounded by what is LEFT of the route budget rather than
        //    the nominal attempt length. Six sequential round trips precede this.
        const remainingMs =
          ROUTE_TIMEOUT_MS - (Date.now() - startedAt) - POST_MODEL_RESERVE_MS;
        const attemptMs = Math.min(SUGGEST_TIMEOUT_MS, remainingMs);

        // ⚠ Fail BEFORE marking the request billable. A usage row means "an
        // inference reached the provider"; a preamble that ate the budget means
        // no request is sent, and charging a daily suggestion for our own
        // slowness punishes the user. This is the last pre-model exit — every
        // other one already sits above `reachedModel`.
        const ceiling = maxTokensForBudget(attemptMs);
        if (
          attemptMs < PREFILL_ALLOWANCE_MS + MIN_USEFUL_GENERATION_MS ||
          ceiling < minUsefulSuggestTokens()
        ) {
          console.warn(
            `[mealprint-suggest] skipped user=${userId} attemptMs=${attemptMs} ceiling=${ceiling} needed=${minUsefulSuggestTokens()}`,
          );
          throw new AiUnavailableError(
            `ai_budget_exhausted: ${Math.max(0, attemptMs)}ms left after the preamble`,
          );
        }

        // Logged AFTER the guard, so a `start` line means a request really was
        // sent. Counts and ids only — the prompt carries the user's food data.
        console.info(
          `[mealprint-suggest] start user=${userId} shape=${shape} candidates=${assembly.candidates.length} attemptMs=${attemptMs} maxTokens=${suggestMaxTokens(attemptMs)}`,
        );

        // Set LAST, immediately before the provider call.
        reachedModel = true;
        const normalMealKcalCeiling = maxMealKcal({
          dailyKcal: target.dailyKcal,
          mealsPerDay: preferences.mealsPerDay,
          shape: shape as SuggestShape,
        });
        const cheatMealKcalCeiling = maxCheatMealKcal({
          dailyKcal: target.dailyKcal,
          mealsPerDay: preferences.mealsPerDay,
        });
        const result = await composeSuggestions(
          {
            shape: shape as SuggestShape,
            occasion,
            remaining,
            maxMealKcal: normalMealKcalCeiling,
            maxCheatMealKcal: cheatMealKcalCeiling,
            steer: steer ?? null,
            candidates: assembly.candidates,
            likedFoods: preferences.likedFoods,
            effortLevel: preferences.effortLevel,
            locale,
          },
          { timeoutMs: attemptMs },
        );

        // Stage 3 — every macro recomputed from DB rows, avoidance re-run.
        const verified = verifySuggestions({
          suggestions: result.suggestions,
          // The EXACT list handed to the model. A wider pool here would let a
          // filtered-out food back in through the model's selection.
          candidates: assembly.candidates,
          remaining,
          preferences,
          maxMealKcal: normalMealKcalCeiling,
          maxCheatMealKcal: cheatMealKcalCeiling,
        });

        console.info(
          `[mealprint-suggest] done user=${userId} model=${result.usage.modelId} latencyMs=${result.usage.latencyMs} inputTokens=${result.usage.inputTokens} outputTokens=${result.usage.outputTokens} ${describeVerification(verified)}`,
        );

        if (verified.suggestions.length === 0) {
          // The model answered and every suggestion failed verification. A 422 is
          // right here (unlike steps 4/5): an inference happened, the daily
          // ceiling IS consumed, and retrying is the sensible client action.
          throw new AiUnreadableError(
            `ai_all_suggestions_rejected: ${describeVerification(verified)}`,
          );
        }

        const body = {
          data: {
            suggestions: verified.suggestions,
            emptyReason: null,
            remaining,
            containsUnverified: verified.suggestions.some(
              (suggestion) => suggestion.containsUnverified,
            ),
            partialEnforcementOnly: verified.suggestions.some(
              (suggestion) => suggestion.partialEnforcementOnly,
            ),
            /**
             * ⚠ ALWAYS TRUE, and deliberately not derived from anything.
             *
             * `containsUnverified` above is a per-row signal (`allergenTags ===
             * null`) and it is NOT sufficient on its own to decide whether to show
             * the label-check disclaimer. `offMapper.mapOffAllergenTags` returns
             * `[]` — "analysed, none found", i.e. `unverified: false` — whenever
             * `ingredients_text` is non-empty, WITHOUT knowing that OFF actually
             * parsed it. A foreign-language ingredient list, a "see packaging"
             * placeholder, or an unparseable free-text blob all yield `[]` and are
             * indistinguishable from a genuinely clean analysis. Those are exactly
             * the rows most likely to be wrong, and they would have suppressed the
             * disclaimer.
             *
             * So AC 1.2 / AC 3.4's disclaimer is UNCONDITIONAL on this surface, and
             * this field makes that a contract the client cannot accidentally
             * narrow. `containsUnverified` remains useful for the STRONGER
             * per-suggestion "we don't know what's in this at all" flag.
             *
             * ⚠ T-1.5 (mobile): render the label-check copy whenever this is true —
             * which is always. Do not gate it on `containsUnverified`.
             */
            labelCheckRequired: true,
          },
        };
        responseSizeBytes = Buffer.byteLength(JSON.stringify(body));
        return body;
      } catch (error) {
        if (error instanceof AiUnreadableError) {
          console.error(`[mealprint-suggest] unreadable: ${error.message}`);
          ctx.set.status = 422;
          const body = { error: "ai_unreadable" };
          responseSizeBytes = Buffer.byteLength(JSON.stringify(body));
          return body;
        }
        if (error instanceof AiUnavailableError) {
          console.error(`[mealprint-suggest] unavailable: ${error.message}`);
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
        shape: t.Union([
          t.Literal("snack"),
          t.Literal("meal"),
          t.Literal("either"),
        ]),
        // Amendment 2026-08 § A.2. Defaults to `on_plan` in the handler above —
        // absent here for backward compatibility with a client that has not yet
        // shipped the occasion selector. Shape is only meaningful for `on_plan`
        // (§ A.1); it is ignored for the other two.
        occasion: t.Optional(
          t.Union([
            t.Literal("on_plan"),
            t.Literal("cheat_meal"),
            t.Literal("eating_out"),
          ]),
        ),
        // The day the remaining budget is computed for. Supplied by the client
        // rather than derived from server time because "today" is the DEVICE's
        // local day — the shipped Fuel screen already passes it to
        // `GET /nutrition/today` for exactly this reason, and deriving it here
        // would give a user in NZ the wrong day's entries.
        date: t.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
        // Bounded because it lands in the prompt. 200 chars is generous for
        // "something sweet using the chicken I have in" and bounds a channel the
        // user controls. For `eating_out`, this is repurposed as the restaurant
        // name (amendment § A.1 table) — same field, same bound.
        steer: t.Optional(t.String({ maxLength: 200 })),
      }),
    },
  );
