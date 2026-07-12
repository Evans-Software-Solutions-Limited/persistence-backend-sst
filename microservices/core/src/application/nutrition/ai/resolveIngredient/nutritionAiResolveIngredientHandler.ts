import Elysia, { t } from "elysia";
import { resolveIngredientFood } from "../../services/resolveIngredientFood";
import {
  AiUnreadableError,
  AiUnavailableError,
} from "../../services/recipeExtraction";
import {
  assertEntitlement,
  EntitlementError,
} from "../../../entitlement/assertEntitlement";
import { AiUsageLogService } from "../../../repositories/aiUsageLogService";
import { FoodService } from "../../../repositories/foodService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

const ENDPOINT = "resolve-ingredient";

// Daily per-user inference ceiling (Recipes AI). Looser than the photo
// ceilings — a single-ingredient text lookup is a cheap task (same shape
// as nutrition's estimate-text ceiling). Fail-safe parse: a mis-set env
// var must not silently disable the cost guard.
const parsedResolveLimit = Number(process.env.AI_RESOLVE_DAILY_LIMIT);
const AI_RESOLVE_DAILY_LIMIT =
  Number.isFinite(parsedResolveLimit) && parsedResolveLimit > 0
    ? parsedResolveLimit
    : 60;

/**
 * POST /nutrition/ai/resolve-ingredient — resolve a recipe-ingredient
 * NAME that missed the `GET /foods` DB search into a created `foods` row
 * via a Bedrock macro estimate (Recipes AI, the AI-CREATE fallback path —
 * see `resolveIngredientFood.ts`). Mirrors
 * `nutrition/ai/estimate/nutritionAiEstimateHandler.ts` for
 * gating/validation/usage-log order: auth → entitlement (`ai_access`) →
 * daily ceiling → adapter call → response. `ai_usage_log` is written in a
 * `finally` on every path that reached the model.
 */
export const nutritionAiResolveIngredientHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(FoodService)
  .use(AiUsageLogService)
  .post(
    "/nutrition/ai/resolve-ingredient",
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
        if (usedToday >= AI_RESOLVE_DAILY_LIMIT) {
          ctx.set.status = 429;
          return { error: "ai_daily_limit" };
        }

        const { name } = ctx.body;

        reachedModel = true;
        const { food } = await resolveIngredientFood(name, userId, {
          foodRepo: ctx.FoodRepository,
        });

        const body = { data: food };
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
      }),
    },
  );
