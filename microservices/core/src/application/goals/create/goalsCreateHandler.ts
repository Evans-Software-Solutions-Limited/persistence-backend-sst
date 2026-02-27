import Elysia, { t } from "elysia";
import { GoalService } from "../../repositories/goalService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

export const goalsCreateHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(GoalService)
  .post(
    "/goals",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const body = ctx.body as Record<string, unknown>;

      const goal = await ctx.GoalRepository.create(userId, {
        goalTypeId: body.goalTypeId as string,
        priority: (body.priority as number) ?? 1,
        isActive: (body.isActive as boolean) ?? true,
        targetDate: body.targetDate as string | undefined,
        notes: body.notes as string | undefined,
      });

      ctx.set.status = 201;
      return { data: goal };
    },
    {
      body: t.Object({
        goalTypeId: t.String(),
        priority: t.Optional(t.Number()),
        isActive: t.Optional(t.Boolean()),
        targetDate: t.Optional(t.String()),
        notes: t.Optional(t.String()),
      }),
    },
  );
