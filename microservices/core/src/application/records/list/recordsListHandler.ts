import Elysia, { t } from "elysia";
import { RecordService } from "../../repositories/recordService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

export const recordsListHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(RecordService)
  .get(
    "/records",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const { exerciseId } = ctx.query as Record<string, string | undefined>;

      const records = await ctx.RecordRepository.list(userId, exerciseId);

      return { data: records };
    },
    {
      query: t.Object({
        exerciseId: t.Optional(t.String()),
      }),
    },
  );
