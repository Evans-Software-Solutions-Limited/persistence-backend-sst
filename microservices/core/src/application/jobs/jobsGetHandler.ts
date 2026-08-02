import Elysia, { t } from "elysia";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { AiJobService } from "./aiJobService";
import { toJobStatusView, toJobView } from "./jobView";

/**
 * GET /jobs/:id — poll an async job (US-2).
 *
 * The one generic endpoint the spine owns. Enqueue deliberately lives on each
 * feature's own route (design § 6) because entitlement, sizing and validation
 * are kind-specific; polling is uniform, so it is not duplicated per feature.
 *
 * ## Owner-scoped, and 404 rather than 403 (AC-2.2)
 *
 * The `user_id` predicate is in the QUERY, so the repository cannot return
 * another user's job at all. A job that exists but belongs to someone else is
 * indistinguishable from one that does not exist — a 403 would confirm the id
 * is real, which is a free oracle over a uuid space that a caller could
 * otherwise learn nothing from.
 *
 * ## No recompute, no write (AC-2.4, design § 3.4)
 *
 * The response comes off the row. This endpoint makes no model call and, in
 * particular, performs NO WRITE — staleness is derived on read, and a poll loop
 * ticking every 2 seconds must not be a write path. The nightly sweep persists
 * the same verdict separately.
 *
 * `?fields=status` omits `result`. A completed 120-workout programme is a large
 * document and the naive poll loop re-downloads it on every tick after
 * completion; the loop should poll with `fields=status` and read the full row
 * once, on the transition to a terminal status.
 */
export const jobsGetHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(AiJobService)
  .get(
    "/jobs/:id",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const job = await ctx.AiJobRepository.getForUser(ctx.params.id, userId);
      if (!job) {
        ctx.set.status = 404;
        return { code: "not_found", message: "Job not found" };
      }
      return {
        data:
          ctx.query.fields === "status" ? toJobStatusView(job) : toJobView(job),
      };
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      // ⚠ `fields` is deliberately NOT declared as a `query` schema.
      //
      // api.ts's root `.use()` chain sits ON TypeScript's instantiation-depth
      // ceiling — adding this route with a declared query schema tripped TS2589
      // on `src/api.ts` (and the ceiling is felt hardest in packages/web, whose
      // Eden `treaty<CoreApi>` client instantiates the whole route type, so a
      // backend-only change can break a package with no edited files). See
      // `loadoutRoutes.ts` and `memory/reference_web_eden_couples_to_core_type`.
      //
      // Nothing is lost by validating it in the body instead: the parameter is a
      // single optional literal, an unrecognised value falls through to the full
      // view, and there is no injection surface in an equality check.
    },
  );
