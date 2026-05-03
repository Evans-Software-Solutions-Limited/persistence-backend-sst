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
        // M3 active-session fields. Defaults match the column defaults
        // in supabase/migrations/20260503000000_m3_session_lifecycle.sql:
        // supersetGroup is nullable; isSubstituted defaults to false;
        // originalExerciseId is nullable.
        supersetGroup:
          body.supersetGroup !== undefined
            ? (body.supersetGroup as number | null)
            : null,
        isSubstituted: (body.isSubstituted as boolean) ?? false,
        originalExerciseId:
          body.originalExerciseId !== undefined
            ? (body.originalExerciseId as string | null)
            : null,
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
        supersetGroup: t.Optional(t.Union([t.Number(), t.Null()])),
        isSubstituted: t.Optional(t.Boolean()),
        originalExerciseId: t.Optional(t.Union([t.String(), t.Null()])),
      }),
    },
  );
