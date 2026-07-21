import Elysia, { t } from "elysia";
import {
  estimateRecipeMacros,
  AiUnreadableError,
  AiUnavailableError,
} from "../../services/recipeExtraction";
import {
  assertEntitlement,
  EntitlementError,
} from "../../../entitlement/assertEntitlement";
import { AiUsageLogService } from "../../../repositories/aiUsageLogService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

const ENDPOINT = "estimate-recipe";

// Daily per-user inference ceiling (Recipes AI). A whole-recipe estimate is a
// single cheap text task (same shape/model as the single-ingredient resolve),
// so it shares that looser ceiling. Fail-safe parse: a mis-set env var must
// not silently disable the cost guard.
const parsedEstimateLimit = Number(process.env.AI_RECIPE_ESTIMATE_DAILY_LIMIT);
const AI_RECIPE_ESTIMATE_DAILY_LIMIT =
  Number.isFinite(parsedEstimateLimit) && parsedEstimateLimit > 0
    ? parsedEstimateLimit
    : 30;

/**
 * POST /nutrition/ai/estimate-recipe — estimate the TOTAL macros for a whole
 * recipe from its name + ingredient lines + servings, via a single Bedrock
 * call (Recipes AI). This is the "value the dish as a whole" path — distinct
 * from `/nutrition/ai/resolve-ingredient`, which fabricates a food row per
 * single ingredient. Returns whole-recipe totals the client stores as the
 * recipe's macros (`providedTotals` on `POST /recipes`).
 *
 * Gating mirrors resolve-ingredient: auth → entitlement (`ai_access`) → daily
 * ceiling → adapter call → response. `ai_usage_log` is written in a `finally`
 * on every path that reached the model.
 */
export const nutritionAiEstimateRecipeHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(AiUsageLogService)
  .post(
    "/nutrition/ai/estimate-recipe",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const startedAt = Date.now();
      const requestSizeBytes = Buffer.byteLength(JSON.stringify(ctx.body));
      let responseSizeBytes: number | null = null;
      let reachedModel = false;

      try {
        const verdict = await assertEntitlement(userId, "ai_access");
        if (!verdict.allowed) {
          throw new EntitlementError(verdict, "ai_access");
        }

        const usedToday = await ctx.AiUsageLogRepository.countForUserToday(
          userId,
          ENDPOINT,
        );
        if (usedToday >= AI_RECIPE_ESTIMATE_DAILY_LIMIT) {
          ctx.set.status = 429;
          return { error: "ai_daily_limit" };
        }

        const { name, ingredients, servings } = ctx.body;

        reachedModel = true;
        const macros = await estimateRecipeMacros({
          name,
          ingredients,
          servings: servings ?? null,
        });

        const body = { data: macros };
        responseSizeBytes = Buffer.byteLength(JSON.stringify(body));
        return body;
      } catch (error) {
        if (error instanceof AiUnreadableError) {
          ctx.set.status = 422;
          const body = { error: "ai_unreadable" };
          responseSizeBytes = Buffer.byteLength(JSON.stringify(body));
          return body;
        }
        if (error instanceof AiUnavailableError) {
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
        name: t.String({ minLength: 1, maxLength: 200 }),
        ingredients: t.Array(t.String({ minLength: 1, maxLength: 300 }), {
          maxItems: 100,
        }),
        servings: t.Optional(t.Number({ exclusiveMinimum: 0 })),
      }),
    },
  );
