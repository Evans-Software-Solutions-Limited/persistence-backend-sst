import Elysia, { t } from "elysia";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { logClientMeasurementOnBehalf } from "./logClientMeasurement";

/**
 * POST /trainers/me/clients/:clientId/measurements — canonical route (cross-
 * cuts § 1.2) for a coach logging a body measurement (typically weight) ON
 * BEHALF OF a client they actively train.
 *
 * Authorization + write logic lives in the shared `logClientMeasurementOnBehalf`
 * core (role-first-then-active-relationship via `assertTrainerCanActForClient`,
 * plus an audit row written in the same transaction as the measurement — see
 * `logClientMeasurement.ts`). The legacy `/clients/:clientId/measurements`
 * path (`trainersLogClientMeasurementHandler`) stays mounted as a temporary
 * alias for older app builds and calls the same core.
 *
 * The measurement is written for the CLIENT (`user_id = clientId`) with
 * `logged_by_user_id = trainerId`. The client's app picks coach-logged
 * weights up on next open and writes them into HealthKit (see mobile
 * `useHealthWeightSync`). The measurement streak is advanced for the CLIENT,
 * matching self-logged parity.
 */
export const trainersMeLogClientMeasurementHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .post(
    "/trainers/me/clients/:clientId/measurements",
    async (ctx) => {
      const { sub: trainerId } = getUser(ctx);
      const { clientId } = ctx.params as { clientId: string };
      const body = ctx.body as Record<string, unknown>;

      const result = await logClientMeasurementOnBehalf({
        trainerId,
        clientId,
        body,
      });

      if (!result.ok) {
        ctx.set.status = result.status;
        return result.body;
      }

      ctx.set.status = 201;
      return { data: result.measurement };
    },
    {
      params: t.Object({ clientId: t.String({ minLength: 1 }) }),
      body: t.Object({
        weightKg: t.Optional(t.Union([t.String(), t.Number()])),
        bodyFatPercentage: t.Optional(t.Union([t.String(), t.Number()])),
        chestCm: t.Optional(t.Union([t.String(), t.Number()])),
        waistCm: t.Optional(t.Union([t.String(), t.Number()])),
        hipsCm: t.Optional(t.Union([t.String(), t.Number()])),
        leftArmCm: t.Optional(t.Union([t.String(), t.Number()])),
        rightArmCm: t.Optional(t.Union([t.String(), t.Number()])),
        leftThighCm: t.Optional(t.Union([t.String(), t.Number()])),
        rightThighCm: t.Optional(t.Union([t.String(), t.Number()])),
        notes: t.Optional(t.String()),
      }),
    },
  );
