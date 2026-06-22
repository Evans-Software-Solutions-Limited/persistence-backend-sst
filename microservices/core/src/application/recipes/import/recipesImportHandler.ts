import Elysia, { t } from "elysia";
import { safeRecipeFetch, RecipeFetchError } from "../services/url-fetch";
import { parseRecipeFromHtml } from "../services/parseRecipe";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/**
 * POST /recipes/import — scrape a Schema.org recipe from a user-supplied URL
 * and return a pre-fill payload for the manual-create form (the user reviews +
 * saves via POST /recipes). M9 is deterministic ld+json scraping only — no AI
 * fallback (Conflict C3). The URL is fetched through `safeRecipeFetch`, which
 * is SSRF-hardened (every guard re-checked per redirect hop).
 *
 * - SSRF / fetch guard failure → 400 with the guard reason.
 * - Page has no Recipe microdata → 422 no_recipe_microdata.
 */
export const recipesImportHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .post(
    "/recipes/import",
    async (ctx) => {
      getUser(ctx); // assert authed

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

      const parsed = parseRecipeFromHtml(html);
      if (!parsed) {
        ctx.set.status = 422;
        return { error: "no_recipe_microdata" };
      }

      return { data: { ...parsed, sourceUrl: finalUrl } };
    },
    {
      body: t.Object({ url: t.String({ minLength: 1 }) }),
    },
  );
