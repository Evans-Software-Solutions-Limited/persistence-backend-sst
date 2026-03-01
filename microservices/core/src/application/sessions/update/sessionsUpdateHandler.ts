import Elysia, { t } from "elysia";
import { SessionService } from "../../repositories/sessionService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

export const sessionsUpdateHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(SessionService)
  .patch(
    "/sessions/:sessionId",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const { sessionId } = ctx.params;
      const body = ctx.body as Record<string, unknown>;

      // Allow updating specific fields
      const allowedFields = [
        "name",
        "status",
        "completedAt",
        "totalDurationSeconds",
        "userNotes",
        "trainerFeedback",
        "sessionRating",
        "overallRpe",
        "difficultyRanking",
      ];

      const updateData: Record<string, unknown> = {};
      for (const field of allowedFields) {
        if (field in body) {
          updateData[field] = body[field];
        }
      }

      if (Object.keys(updateData).length === 0) {
        ctx.set.status = 400;
        return { error: "No valid fields to update" };
      }

      const session = await ctx.SessionRepository.update(sessionId, 
        userId,
        updateData,
      );

      if (!session) {
        ctx.set.status = 404;
        return { error: "Session not found" };
      }

      return { data: session };
    },
    {
      params: t.Object({
        sessionId: t.String(),
      }),
      body: t.Object({
        name: t.Optional(t.String()),
        status: t.Optional(t.String()),
        completedAt: t.Optional(t.Union([t.String(), t.Null()])),
        totalDurationSeconds: t.Optional(t.Number()),
        userNotes: t.Optional(t.String()),
        trainerFeedback: t.Optional(t.String()),
        sessionRating: t.Optional(t.Number()),
        overallRpe: t.Optional(t.Number()),
        difficultyRanking: t.Optional(t.Number()),
      }),
    },
  );
