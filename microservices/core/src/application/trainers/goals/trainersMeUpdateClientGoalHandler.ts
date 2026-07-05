import Elysia, { t } from "elysia";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { updateClientGoalOnBehalf } from "./updateClientGoal";

/**
 * PUT /trainers/me/clients/:clientId/goals/:id — a coach edits a goal they
 * previously assigned to the client (cross-cuts § 2.2 — edit-own only). The
 * shared `updateClientGoalOnBehalf` core enforces the assigner check and
 * returns 403 `not_assigner` when the caller is not the goal's
 * `assigned_by_user_id`. Body mirrors the self `PATCH /goals/:id` validator.
 */
export const trainersMeUpdateClientGoalHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .put(
    "/trainers/me/clients/:clientId/goals/:id",
    async (ctx) => {
      const { sub: trainerId } = getUser(ctx);
      const { clientId, id } = ctx.params as { clientId: string; id: string };
      const body = ctx.body as Record<string, unknown>;

      const result = await updateClientGoalOnBehalf({
        trainerId,
        clientId,
        goalId: id,
        body: {
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

      return { data: result.goal };
    },
    {
      params: t.Object({
        clientId: t.String({ minLength: 1 }),
        id: t.String({ minLength: 1 }),
      }),
      body: t.Object({
        priority: t.Optional(t.Number()),
        isActive: t.Optional(t.Boolean()),
        targetDate: t.Optional(t.String()),
        notes: t.Optional(t.String()),
      }),
    },
  );
