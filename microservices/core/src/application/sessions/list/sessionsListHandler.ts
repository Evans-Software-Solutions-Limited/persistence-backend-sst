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
      const { limit = "20", offset = "0" } = ctx.query as Record<
        string,
        string
      >;

      const sessions = await ctx.SessionRepository.list(
        userId,
        parseInt(limit, 10),
        parseInt(offset, 10),
      );

      return { data: sessions };
    },
    {
      query: t.Object({
        limit: t.Optional(t.String()),
        offset: t.Optional(t.String()),
      }),
    },
  );
