import Elysia, { t } from "elysia";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { assignClientGoalOnBehalf } from "./assignClientGoal";

/**
 * POST /trainers/me/clients/:clientId/goals — canonical route (cross-cuts
 * § 1.2) for a coach assigning a goal to a client they actively train
 * (cross-cuts § 2.1). The goal is written for the CLIENT with
 * `assigned_by_user_id = trainerId`. Body mirrors the self `POST /goals`
 * validator. Authorization + write + audit + notification live in the shared
 * `assignClientGoalOnBehalf` core.
 */
export const trainersMeAssignClientGoalHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .post(
    "/trainers/me/clients/:clientId/goals",
    async (ctx) => {
      const { sub: trainerId } = getUser(ctx);
      const { clientId } = ctx.params as { clientId: string };
      const body = ctx.body as Record<string, unknown>;

      const result = await assignClientGoalOnBehalf({
        trainerId,
        clientId,
        body: {
          goalTypeId: body.goalTypeId as string,
          priority: body.priority as number | undefined,
          isActive: body.isActive as boolean | undefined,
          targetDate: body.targetDate as string | undefined,
          notes: body.notes as string | undefined,
        },
      });

      if (!result.ok) {
        ctx.set.status = result.status;
        return result.body;
      }

      ctx.set.status = 201;
      return { data: result.goal };
    },
    {
      params: t.Object({ clientId: t.String({ minLength: 1 }) }),
      body: t.Object({
        goalTypeId: t.String(),
        priority: t.Optional(t.Number()),
        isActive: t.Optional(t.Boolean()),
        targetDate: t.Optional(t.String()),
        notes: t.Optional(t.String()),
      }),
    },
  );
