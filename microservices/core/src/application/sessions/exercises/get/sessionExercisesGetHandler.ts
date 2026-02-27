import Elysia, { t } from "elysia";
import { SessionService } from "../../../repositories/sessionService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

export const sessionExercisesGetHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(SessionService)
  .get(
    "/sessions/:sessionId/exercises",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const { sessionId } = ctx.params;

      // Verify session ownership
      const session = await ctx.SessionRepository.getById(sessionId, userId);
      if (!session) {
        ctx.set.status = 404;
        return { error: "Session not found" };
      }

      const exercises =
        await ctx.SessionRepository.getSessionExercises(sessionId);

      return { data: exercises };
    },
    {
      params: t.Object({
        sessionId: t.String(),
      }),
    },
  );
