import Elysia, { t } from "elysia";
import { recordTypeEnum } from "@persistence/db";
import { PersonalRecordsService } from "../../repositories/personalRecordsService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/**
 * GET /personal-records
 *
 * Lists the signed-in user's PRs, optionally filtered by exercise and /
 * or record type. Used by:
 *   - Mobile quick-fill suggestions while logging sets (filter by
 *     exerciseId for the previous best on that exercise).
 *   - Mobile predictive PR detection on the Summary screen (cached
 *     locally on the device; refreshed via this endpoint).
 *   - M4 Progress tab's PR carousel (full list, no filter).
 *
 * Server-side PR detection runs at session-complete time inside
 * sessionsUpdateHandler — see the next commit. This endpoint is the
 * read path against the canonical `personal_records` table.
 */
export const personalRecordsListHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(PersonalRecordsService)
  .get(
    "/personal-records",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const { exerciseId, recordType, limit, offset } = ctx.query;

      const records = await ctx.PersonalRecordsRepository.list(userId, {
        exerciseId,
        recordType,
        limit,
        offset,
      });

      return { data: records };
    },
    {
      query: t.Object({
        exerciseId: t.Optional(t.String()),
        // Match the Postgres enum exactly. Keep this in sync with
        // `packages/db/src/schema.ts:60` if new types land.
        recordType: t.Optional(
          t.Union(recordTypeEnum.enumValues.map((v) => t.Literal(v))),
        ),
        limit: t.Optional(t.Numeric()),
        offset: t.Optional(t.Numeric()),
      }),
    },
  );
