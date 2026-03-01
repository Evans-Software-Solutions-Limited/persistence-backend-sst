import Elysia, { t } from "elysia";
import { SessionService } from "../../repositories/sessionService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

export const sessionsGetHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(SessionService)
  .get(
    "/sessions/:sessionId",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const { sessionId } = ctx.params;

      const session = await ctx.SessionRepository.getById(sessionId, userId);

      if (!session) {
        ctx.set.status = 404;
        return { error: "Session not found" };
      }

      return { data: session };
    },
    {
      params: t.Object({
        sessionId: t.String(),
      }),
    },
  );
