import Elysia, { t } from "elysia";
import { safeRecipeFetch, RecipeFetchError } from "../services/url-fetch";
import { parseRecipeFromHtml } from "../services/parseRecipe";
import { readableRecipeText } from "../services/parseVisibleRecipe";
import {
  extractRecipeFromText,
  prepareRecipeAiText,
  RECIPE_TEXT_LIMIT,
} from "../services/aiRecipeFromText";
import { assertEntitlement } from "../../entitlement/assertEntitlement";
import { AiUsageLogService } from "../../repositories/aiUsageLogService";

const parsedLimit = Number(process.env.AI_RECIPE_DAILY_LIMIT);
const DAILY_LIMIT =
  Number.isFinite(parsedLimit) && parsedLimit > 0
    ? Math.floor(parsedLimit)
    : 12;
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/** Authenticated URL import: guarded fetch → structured/readable parsing →
 * entitled, quota-reserved text-only AI fallback. All unreadable/unavailable
 * fallback paths retain manual recovery; model output never triggers a fetch. */
export const recipesImportHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(AiUsageLogService)
  .post(
    "/recipes/import",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);

      let html: string;
      let finalUrl: string;
      try {
        ({ html, finalUrl } = await safeRecipeFetch(ctx.body.url));
      } catch (e) {
        if (e instanceof RecipeFetchError) {
          ctx.set.status = 400;
          return { error: e.reason };
        }
        throw e;
      }

      let parsed = parseRecipeFromHtml(html);
      if (!parsed) {
        const text = prepareRecipeAiText(
          readableRecipeText(html, RECIPE_TEXT_LIMIT + 1),
        );
        if (text) {
          try {
            const verdict = await assertEntitlement(userId, "ai_access");
            if (
              verdict.allowed &&
              (await ctx.AiUsageLogRepository.reserveForUserToday({
                userId,
                endpoint: "/recipes/import",
                limit: DAILY_LIMIT,
                requestSizeBytes: Buffer.byteLength(text),
              }))
            ) {
              parsed = await extractRecipeFromText(text);
            }
          } catch {
            // Fail closed if entitlement, quota storage or inference is unavailable.
            // Never log page content, signed source URLs or provider payloads.
          }
        }
      }
      if (!parsed) {
        ctx.set.status = 422;
        return { error: "no_recipe_microdata" };
      }

      return {
        data: {
          ...parsed,
          extractionMethod: parsed.extractionMethod ?? "structured",
          sourceUrl: finalUrl,
        },
      };
    },
    {
      body: t.Object({ url: t.String({ minLength: 1, maxLength: 8192 }) }),
    },
  );
