import Elysia, { t } from "elysia";
import { SessionService } from "../../../repositories/sessionService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

export const setsCreateHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(SessionService)
  .post(
    "/sessions/:sessionId/exercises/:sessionExerciseId/sets",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const { sessionId, sessionExerciseId } = ctx.params;
      const body = ctx.body as Record<string, unknown>;

      const session = await ctx.SessionRepository.getById(sessionId, userId);
      if (!session) {
        ctx.set.status = 404;
        return { error: "Session not found" };
      }

      const sessionExercise = session.exercises.find(
        (ex) => ex.id === sessionExerciseId,
      );
      if (!sessionExercise) {
        ctx.set.status = 404;
        return { error: "Exercise not found in session" };
      }

      // Per M3 spec, mobile clients can mark a set complete at log time
      // with `isCompleted: true` + a wall-clock `completedAt`. If the
      // client passes only `isCompleted: true` without a timestamp, we
      // stamp `completedAt = now` server-side so the row always has
      // both consistently.
      const isCompletedFlag = body.isCompleted as boolean | undefined;
      const completedAtIso =
        body.completedAt !== undefined
          ? (body.completedAt as string | null)
          : isCompletedFlag === true
            ? new Date().toISOString()
            : undefined;

      const setData = {
        sessionExerciseId: sessionExercise.id,
        setNumber: (body.setNumber as number) ?? 1,
        reps: body.reps as number | undefined | null,
        weightKg:
          body.weightKg !== undefined ? String(body.weightKg) : undefined,
        durationSeconds: body.durationSeconds as number | undefined | null,
        distanceMeters:
          body.distanceMeters !== undefined
            ? String(body.distanceMeters)
            : undefined,
        rpe: body.rpe as number | undefined | null,
        restAfterSeconds: body.restAfterSeconds as number | undefined | null,
        isPersonalRecord: (body.isPersonalRecord as boolean) ?? false,
        isCompleted: isCompletedFlag ?? false,
        completedAt: completedAtIso ? new Date(completedAtIso) : null,
      };

      const set = await ctx.SessionRepository.addSet(setData);

      ctx.set.status = 201;
      return { data: set };
    },
    {
      params: t.Object({
        sessionId: t.String(),
        sessionExerciseId: t.String(),
      }),
      body: t.Object({
        setNumber: t.Optional(t.Number()),
        reps: t.Optional(t.Number()),
        weightKg: t.Optional(t.Union([t.String(), t.Number()])),
        durationSeconds: t.Optional(t.Number()),
        distanceMeters: t.Optional(t.Union([t.String(), t.Number()])),
        rpe: t.Optional(t.Number()),
        restAfterSeconds: t.Optional(t.Number()),
        isPersonalRecord: t.Optional(t.Boolean()),
        isCompleted: t.Optional(t.Boolean()),
        completedAt: t.Optional(t.Union([t.String(), t.Null()])),
      }),
    },
  );
