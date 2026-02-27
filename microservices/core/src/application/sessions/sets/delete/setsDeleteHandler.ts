import Elysia, { t } from "elysia";
import { SessionService } from "../../../repositories/sessionService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

export const setsDeleteHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(SessionService)
  .delete(
    "/sessions/:sessionId/exercises/:sessionExerciseId/sets/:setId",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const { sessionId, sessionExerciseId, setId } = ctx.params;

      const set = await ctx.SessionRepository.getSetInSession(
        sessionId,
        sessionExerciseId,
        setId,
        userId,
      );
      if (!set) {
        ctx.set.status = 404;
        return { error: "Set not found" };
      }

      const deleted = await ctx.SessionRepository.deleteSet(setId, userId);
      if (!deleted) {
        ctx.set.status = 404;
        return { error: "Set not found" };
      }

      return { data: { success: true } };
    },
    {
      params: t.Object({
        sessionId: t.String(),
        sessionExerciseId: t.String(),
        setId: t.String(),
      }),
    },
  );
