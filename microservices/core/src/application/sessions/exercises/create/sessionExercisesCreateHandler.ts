import Elysia, { t } from "elysia";
import { SessionService } from "../../../repositories/sessionService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

export const sessionExercisesCreateHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(SessionService)
  .post(
    "/sessions/:sessionId/exercises",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const { sessionId } = ctx.params;
      const body = ctx.body as Record<string, unknown>;

      // Verify session ownership
      const session = await ctx.SessionRepository.getById(sessionId, userId);
      if (!session) {
        ctx.set.status = 404;
        return { error: "Session not found" };
      }

      const exerciseData = {
        sessionId,
        exerciseId: body.exerciseId as string,
        sortOrder: (body.sortOrder as number) ?? 1,
        notes: body.notes as string | undefined,
      };

      const exercise = await ctx.SessionRepository.addExercise(exerciseData);

      ctx.set.status = 201;
      return { data: exercise };
    },
    {
      params: t.Object({
        sessionId: t.String(),
      }),
      body: t.Object({
        exerciseId: t.String(),
        sortOrder: t.Optional(t.Number()),
        notes: t.Optional(t.String()),
      }),
    },
  );
