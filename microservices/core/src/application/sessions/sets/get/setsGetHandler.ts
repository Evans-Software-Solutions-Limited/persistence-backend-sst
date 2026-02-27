import Elysia, { t } from "elysia";
import { SessionService } from "../../../repositories/sessionService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

export const setsGetHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(SessionService)
  .get(
    "/sessions/:sessionId/exercises/:exerciseId/sets",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const { sessionId, exerciseId } = ctx.params;

      // Verify session ownership
      const session = await ctx.SessionRepository.getById(sessionId, userId);
      if (!session) {
        ctx.set.status = 404;
        return { error: "Session not found" };
      }

      // Find the session exercise to get its ID
      const sessionExercise = session.exercises.find(
        (ex) => ex.exerciseId === exerciseId,
      );
      if (!sessionExercise) {
        ctx.set.status = 404;
        return { error: "Exercise not found in session" };
      }

      const sets = await ctx.SessionRepository.getExerciseSets(
        sessionExercise.id,
      );

      return { data: sets };
    },
    {
      params: t.Object({
        sessionId: t.String(),
        exerciseId: t.String(),
      }),
    },
  );
