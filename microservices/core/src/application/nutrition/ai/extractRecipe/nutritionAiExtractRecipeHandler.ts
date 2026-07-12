import Elysia, { t } from "elysia";
import {
  extractRecipeFromPhoto,
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
import {
  decodeBase64,
  hasValidImageMagicBytes,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_BASE64_LENGTH,
} from "../imageValidation";

const ENDPOINT = "extract-recipe";

// Daily per-user inference ceiling (Recipes AI, mirrors the M9.5 photo-
// estimate ceiling — cross-cuts § 4.3). A cost backstop, not a product
// quota. Fail-safe parse: a mis-set env var (garbage → NaN, "" → 0) must
// not silently disable the cost guard — anything non-finite/non-positive
// falls back to the default.
const parsedRecipeLimit = Number(process.env.AI_RECIPE_DAILY_LIMIT);
const AI_RECIPE_DAILY_LIMIT =
  Number.isFinite(parsedRecipeLimit) && parsedRecipeLimit > 0
    ? parsedRecipeLimit
    : 12;

/**
 * POST /nutrition/ai/extract-recipe — base64 JSON photo of a recipe
 * DOCUMENT (cookbook page / card / screenshot / handwritten) →
 * `ExtractedRecipe` (Recipes AI). Mirrors
 * `nutrition/ai/estimate/nutritionAiEstimateHandler.ts` exactly for
 * gating/validation/usage-log order: auth → entitlement (`ai_access`) →
 * daily ceiling → size cap → magic-byte check → adapter call → response.
 * `ai_usage_log` is written in a `finally` on every path that reached the
 * model (success or failure) — pre-model rejections never consume the
 * daily ceiling.
 */
export const nutritionAiExtractRecipeHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(AiUsageLogService)
  .post(
    "/nutrition/ai/extract-recipe",
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
        if (usedToday >= AI_RECIPE_DAILY_LIMIT) {
          ctx.set.status = 429;
          return { error: "ai_daily_limit" };
        }

        const { imageBase64, mediaType } = ctx.body;

        const decoded = decodeBase64(imageBase64);
        if (decoded === null) {
          ctx.set.status = 400;
          const body = { error: "invalid_image_data" };
          responseSizeBytes = Buffer.byteLength(JSON.stringify(body));
          return body;
        }

        const encodedBytes = Buffer.byteLength(imageBase64, "utf8");
        if (
          decoded.length > MAX_IMAGE_BYTES ||
          encodedBytes > MAX_IMAGE_BYTES
        ) {
          ctx.set.status = 413;
          const body = { error: "image_too_large" };
          responseSizeBytes = Buffer.byteLength(JSON.stringify(body));
          return body;
        }

        const magicOk = hasValidImageMagicBytes(decoded, mediaType);
        if (!magicOk) {
          ctx.set.status = 400;
          const body = { error: "invalid_image_data" };
          responseSizeBytes = Buffer.byteLength(JSON.stringify(body));
          return body;
        }

        reachedModel = true;
        const recipe = await extractRecipeFromPhoto({ imageBase64, mediaType });

        const body = { data: recipe };
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
        imageBase64: t.String({
          minLength: 1,
          maxLength: MAX_IMAGE_BASE64_LENGTH,
        }),
        mediaType: t.Union([t.Literal("image/jpeg"), t.Literal("image/png")]),
      }),
    },
  );
