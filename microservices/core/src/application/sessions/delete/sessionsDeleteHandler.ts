import Elysia, { t } from "elysia";
import { SessionService } from "../../repositories/sessionService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

export const sessionsDeleteHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(SessionService)
  .delete(
    "/sessions/:id",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const { id } = ctx.params;

      const deleted = await ctx.SessionRepository.delete(id, userId);

      if (!deleted) {
        ctx.set.status = 404;
        return { error: "Session not found" };
      }

      return { data: { success: true } };
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  );
