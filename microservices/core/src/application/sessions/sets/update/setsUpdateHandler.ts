import Elysia, { t } from "elysia";
import { SessionService } from "../../../repositories/sessionService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

export const setsUpdateHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(SessionService)
  .patch(
    "/sessions/:sessionId/exercises/:sessionExerciseId/sets/:setId",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const { sessionId, sessionExerciseId, setId } = ctx.params;
      const body = ctx.body as Record<string, unknown>;

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

      const updateData: Record<string, unknown> = {};
      if (body.reps !== undefined) updateData.reps = body.reps;
      if (body.weightKg !== undefined)
        updateData.weightKg = String(body.weightKg);
      if (body.durationSeconds !== undefined)
        updateData.durationSeconds = body.durationSeconds;
      if (body.distanceMeters !== undefined)
        updateData.distanceMeters = String(body.distanceMeters);
      if (body.rpe !== undefined) updateData.rpe = body.rpe;
      if (body.restAfterSeconds !== undefined)
        updateData.restAfterSeconds = body.restAfterSeconds;
      if (body.isPersonalRecord !== undefined)
        updateData.isPersonalRecord = body.isPersonalRecord;

      if (Object.keys(updateData).length === 0) {
        ctx.set.status = 400;
        return { error: "No valid fields to update" };
      }

      const updated = await ctx.SessionRepository.updateSet(
        setId,
        userId,
        updateData,
      );
      if (!updated) {
        ctx.set.status = 404;
        return { error: "Set not found" };
      }

      return { data: updated };
    },
    {
      params: t.Object({
        sessionId: t.String(),
        sessionExerciseId: t.String(),
        setId: t.String(),
      }),
      body: t.Object({
        reps: t.Optional(t.Number()),
        weightKg: t.Optional(t.Union([t.String(), t.Number()])),
        durationSeconds: t.Optional(t.Number()),
        distanceMeters: t.Optional(t.Union([t.String(), t.Number()])),
        rpe: t.Optional(t.Number()),
        restAfterSeconds: t.Optional(t.Number()),
        isPersonalRecord: t.Optional(t.Boolean()),
      }),
    },
  );
