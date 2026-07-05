import Elysia, { t } from "elysia";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { setClientNutritionTargetOnBehalf } from "./setClientNutritionTarget";

/**
 * PUT /trainers/me/clients/:clientId/nutrition/target — canonical route
 * (cross-cuts § 1.2) for a coach setting a client's daily kcal/macros/water
 * target. Reuses the self `PUT /nutrition/targets` validator; stamps
 * `set_by_user_id = trainerId`. Authorization + write + audit + notification
 * live in the shared `setClientNutritionTargetOnBehalf` core.
 *
 * Nutrition is otherwise OFF LIMITS for the coach surface — this one target
 * write is in scope per the Phase 3 mandate.
 */
export const trainersMeSetClientNutritionTargetHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .put(
    "/trainers/me/clients/:clientId/nutrition/target",
    async (ctx) => {
      const { sub: trainerId } = getUser(ctx);
      const { clientId } = ctx.params as { clientId: string };

      const result = await setClientNutritionTargetOnBehalf({
        trainerId,
        clientId,
        body: {
          dailyKcal: ctx.body.dailyKcal,
          proteinG: ctx.body.proteinG,
          carbsG: ctx.body.carbsG,
          fatG: ctx.body.fatG,
          waterCups: ctx.body.waterCups,
          preset: ctx.body.preset,
        },
      });

      if (!result.ok) {
        ctx.set.status = result.status;
        return result.body;
      }

      return { data: result.target };
    },
    {
      params: t.Object({ clientId: t.String({ minLength: 1 }) }),
      body: t.Object({
        // minimum: 0 — targets can't be negative (parity with self route).
        dailyKcal: t.Number({ minimum: 0 }),
        proteinG: t.Number({ minimum: 0 }),
        carbsG: t.Number({ minimum: 0 }),
        fatG: t.Number({ minimum: 0 }),
        waterCups: t.Integer({ minimum: 0 }),
        preset: t.Optional(t.String()),
      }),
    },
  );
