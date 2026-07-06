import Elysia, { t } from "elysia";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { configureClientHabitOnBehalf } from "./configureClientHabit";

/**
 * PUT /trainers/me/clients/:clientId/habits/:category/config — a coach sets or
 * edits a client's habit (18-habit-setup Phase 18.3; design.md § 3.2, STORY-006
 * AC 6.1). Stamps `assigned_by_user_id = trainerId` + writes a `goal_assigned`
 * audit row in one transaction. Body mirrors the self PUT validator. Auth +
 * write + audit live in the shared `configureClientHabitOnBehalf` core.
 */
export const trainersMeSetClientHabitConfigHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .put(
    "/trainers/me/clients/:clientId/habits/:category/config",
    async (ctx) => {
      const { sub: trainerId } = getUser(ctx);
      const { clientId, category } = ctx.params as {
        clientId: string;
        category: string;
      };

      const result = await configureClientHabitOnBehalf({
        trainerId,
        clientId,
        category,
        body: {
          targetValue: ctx.body.targetValue,
          daysPerWeek: ctx.body.daysPerWeek,
          tolerancePct: ctx.body.tolerancePct,
        },
      });

      if (!result.ok) {
        ctx.set.status = result.status;
        return result.body;
      }
      return { data: result.view };
    },
    {
      params: t.Object({
        clientId: t.String({ minLength: 1 }),
        category: t.String(),
      }),
      body: t.Object({
        targetValue: t.Number(),
        daysPerWeek: t.Optional(t.Number()),
        tolerancePct: t.Optional(t.Number()),
      }),
    },
  );
