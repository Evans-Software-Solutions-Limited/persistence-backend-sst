import Elysia, { t } from "elysia";
import { MIN_SEARCH_LENGTH } from "../../repositories/exerciseRepository";
import { ExerciseService } from "../../repositories/exerciseService";
import { getAuthUser } from "@persistence/api-utils/auth/supabaseAuth";

/**
 * GET /exercises/search — full-text + trigram fuzzy search over the
 * exercise catalogue, scoped to the same visibility predicate as
 * `GET /exercises` (system ∪ own customs ∪ connected-PT customs;
 * unauthenticated → system only).
 *
 * `q` is required, trimmed, and must be at least MIN_SEARCH_LENGTH
 * after trim — 1-char prefix queries return almost the entire
 * catalogue, so we reject them up-front to avoid wasting work.
 *
 * Route MUST be registered before `GET /exercises/:id` in api.ts —
 * otherwise the `:id` matcher captures "search" as a literal id and the
 * request never reaches this handler.
 *
 * Spec: specs/03-exercise-library/POSTGRES_FTS_INVESTIGATION.md.
 */

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

export const exercisesSearchHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .use(ExerciseService)
  .get(
    "/exercises/search",
    async (ctx) => {
      const userId = ctx.user?.sub ?? null;
      const qRaw = ctx.query.q.trim();

      if (qRaw.length < MIN_SEARCH_LENGTH) {
        ctx.set.status = 400;
        return {
          error: `q must be at least ${MIN_SEARCH_LENGTH} characters after trim`,
        };
      }

      const rawLimit = ctx.query.limit ?? DEFAULT_LIMIT;
      // Clamp against MAX_LIMIT — search responses don't need full-catalogue
      // pagination ceilings; 100 covers any sane "show me ranked matches"
      // request and protects Lambda payload size.
      const limit = Math.min(Math.max(1, rawLimit), MAX_LIMIT);
      const offset = Math.max(0, ctx.query.offset ?? 0);

      const { rows, total } = await ctx.ExerciseRepository.search(
        qRaw,
        userId,
        limit,
        offset,
      );

      // Same double-envelope wire shape as `GET /exercises`: outer `data`
      // is the generic success envelope; inner is the paginated page
      // payload. Mobile adapter mirrors this shape.
      return {
        data: {
          data: rows,
          meta: { total, offset, limit },
        },
      };
    },
    {
      query: t.Object({
        q: t.String(),
        limit: t.Optional(t.Numeric()),
        offset: t.Optional(t.Numeric()),
      }),
    },
  );
