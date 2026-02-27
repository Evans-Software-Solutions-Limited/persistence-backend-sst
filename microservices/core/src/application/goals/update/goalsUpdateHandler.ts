import Elysia, { t } from "elysia";
import { GoalService } from "../../repositories/goalService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

export const goalsUpdateHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(GoalService)
  .patch(
    "/goals/:id",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const { id } = ctx.params;
      const body = ctx.body as Record<string, unknown>;

      // Allow updating specific fields
      const allowedFields = ["priority", "isActive", "targetDate", "notes"];

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

      const goal = await ctx.GoalRepository.update(id, userId, updateData);

      if (!goal) {
        ctx.set.status = 404;
        return { error: "Goal not found" };
      }

      return { data: goal };
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        priority: t.Optional(t.Number()),
        isActive: t.Optional(t.Boolean()),
        targetDate: t.Optional(t.String()),
        notes: t.Optional(t.String()),
      }),
    },
  );
