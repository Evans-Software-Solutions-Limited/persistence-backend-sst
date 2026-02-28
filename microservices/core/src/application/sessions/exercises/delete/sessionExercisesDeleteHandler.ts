import Elysia, { t } from "elysia";
import { SessionService } from "../../../repositories/sessionService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

export const sessionExercisesDeleteHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(SessionService)
  .delete(
    "/sessions/:sessionId/exercises/:sessionExerciseId",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const { sessionId, sessionExerciseId } = ctx.params;

      const session = await ctx.SessionRepository.getById(sessionId, userId);
      if (!session) {
        ctx.set.status = 404;
        return { error: "Session not found" };
      }

      const belongsToSession = session.exercises.some(
        (ex) => ex.id === sessionExerciseId,
      );
      if (!belongsToSession) {
        ctx.set.status = 404;
        return { error: "Exercise not found in session" };
      }

      const deleted = await ctx.SessionRepository.removeExercise(
        sessionExerciseId,
        userId,
      );
      if (!deleted) {
        ctx.set.status = 404;
        return { error: "Exercise not found in session" };
      }

      return { data: { success: true } };
    },
    {
      params: t.Object({
        sessionId: t.String(),
        sessionExerciseId: t.String(),
      }),
    },
  );
