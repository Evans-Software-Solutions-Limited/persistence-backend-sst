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
      const body = ctx.body as Record<string, unknown>;

      const session = await ctx.SessionRepository.create(userId, {
        workoutId: body.workoutId as string | undefined,
        name: body.name as string | undefined,
        status:
          (body.status as "in_progress" | "completed" | "cancelled") ??
          "in_progress",
        userNotes: body.userNotes as string | undefined,
      });

      ctx.set.status = 201;
      return { data: session };
    },
    {
      body: t.Object({
        workoutId: t.Optional(t.String()),
        name: t.Optional(t.String()),
        status: t.Optional(t.String()),
        userNotes: t.Optional(t.String()),
      }),
    },
  );
