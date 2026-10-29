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

      // Per M3 spec, mobile clients can mark a set complete at log
      // time with `isCompleted: true` + a wall-clock `completedAt`.
      // The server enforces the invariant: a completed set ALWAYS
      // has a `completedAt` timestamp. Three resolution paths:
      //
      //   1. Client sent a real ISO string for `completedAt` → use it.
      //   2. Client sent `null` (or omitted the key) AND
      //      `isCompleted: true` → server stamps `now()`.
      //   3. Client sent `null` (or omitted) AND `isCompleted: false`
      //      (or omitted) → row's `completedAt` stays null.
      //
      // The bugbot finding flagged that `completedAt: null` paired
      // with `isCompleted: true` previously bypassed the auto-stamp
      // (the old check used `body.completedAt !== undefined`, which
      // is true for null — so null silently survived to the row).
      // Now path 2 fires regardless of whether the client sent null
      // or omitted the key.
      const isCompletedFlag =
        (body.isCompleted as boolean | undefined) ?? false;
      const explicitCompletedAt =
        typeof body.completedAt === "string" ? body.completedAt : null;
      const completedAtDate: Date | null =
        explicitCompletedAt !== null
          ? new Date(explicitCompletedAt)
          : isCompletedFlag
            ? new Date()
            : null;

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
        isCompleted: isCompletedFlag,
        completedAt: completedAtDate,
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
