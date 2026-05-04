import Elysia, { t } from "elysia";
import { SessionService } from "../../repositories/sessionService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

export const sessionsListHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(SessionService)
  .get(
    "/sessions",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const { limit, offset, status } = ctx.query;

      const sessions = await ctx.SessionRepository.list(userId, {
        limit: limit ?? 20,
        offset: offset ?? 0,
        status,
      });

      return { data: sessions };
    },
    {
      query: t.Object({
        limit: t.Optional(t.Numeric()),
        offset: t.Optional(t.Numeric()),
        // M3: filter by session status. The mobile client uses
        // ?status=in_progress on app launch to detect a resumable
        // session for the resume-prompt flow (Story-008).
        status: t.Optional(
          t.Union([
            t.Literal("in_progress"),
            t.Literal("completed"),
            t.Literal("cancelled"),
          ]),
        ),
      }),
    },
  );
