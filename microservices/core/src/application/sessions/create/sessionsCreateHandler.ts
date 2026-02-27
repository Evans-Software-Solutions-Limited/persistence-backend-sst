import Elysia, { t } from "elysia";
import { SessionService } from "../../repositories/sessionService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

export const sessionsCreateHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(SessionService)
  .post(
    "/sessions",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const { workoutId, name, status, userNotes } = ctx.body;

      const session = await ctx.SessionRepository.create(userId, {
        workoutId,
        name,
        status: status ?? "in_progress",
        userNotes,
      });

      ctx.set.status = 201;
      return { data: session };
    },
    {
      body: t.Object({
        workoutId: t.Optional(t.String()),
        name: t.Optional(t.String()),
        status: t.Optional(
          t.Union([
            t.Literal("in_progress"),
            t.Literal("completed"),
            t.Literal("cancelled"),
          ]),
        ),
        userNotes: t.Optional(t.String()),
      }),
    },
  );
