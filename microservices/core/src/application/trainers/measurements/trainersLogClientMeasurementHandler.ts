import Elysia, { t } from "elysia";
import { and, eq } from "drizzle-orm";
import { ptClientRelationships } from "@persistence/db";
import { getDb } from "@persistence/db/client";
import { MeasurementService } from "../../repositories/measurementService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { safeEvaluateStreaks } from "../../streaks/evaluate";

/**
 * POST /clients/:clientId/measurements — a coach logs a body measurement
 * (typically weight) ON BEHALF OF a client they actively train.
 *
 * Authorization: the caller MUST have an ACTIVE, non-AI relationship with
 * :clientId as the trainer. We don't gate on role alone — an active
 * relationship is the real permission, and it implicitly proves the trainer
 * role (only trainers appear as `trainer_id`). 403 otherwise.
 *
 * The measurement is written for the CLIENT (`user_id = clientId`) with
 * `logged_by_user_id = trainerId` (the existing audit column). The client's
 * app picks coach-logged weights up on next open and writes them into
 * HealthKit (see mobile `useHealthWeightSync`). The measurement streak is
 * advanced for the CLIENT, matching self-logged parity.
 */
export const trainersLogClientMeasurementHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(MeasurementService)
  .post(
    "/clients/:clientId/measurements",
    async (ctx) => {
      const { sub: trainerId } = getUser(ctx);
      const { clientId } = ctx.params as { clientId: string };
      const body = ctx.body as Record<string, unknown>;

      // Active-relationship guard (trainer side of the pair).
      const db = getDb();
      const rel = await db
        .select({ id: ptClientRelationships.id })
        .from(ptClientRelationships)
        .where(
          and(
            eq(ptClientRelationships.trainerId, trainerId),
            eq(ptClientRelationships.clientId, clientId),
            eq(ptClientRelationships.status, "active"),
            eq(ptClientRelationships.isAiTrainer, false),
          ),
        )
        .limit(1);

      if (!rel[0]) {
        ctx.set.status = 403;
        return {
          code: "not_your_client",
          message: "You can only log measurements for your active clients",
        };
      }

      const toStr = (v: unknown) => (v !== undefined ? String(v) : undefined);
      const measurement = await ctx.MeasurementRepository.create(clientId, {
        loggedByUserId: trainerId,
        weightKg: toStr(body.weightKg),
        bodyFatPercentage: toStr(body.bodyFatPercentage),
        chestCm: toStr(body.chestCm),
        waistCm: toStr(body.waistCm),
        hipsCm: toStr(body.hipsCm),
        leftArmCm: toStr(body.leftArmCm),
        rightArmCm: toStr(body.rightArmCm),
        leftThighCm: toStr(body.leftThighCm),
        rightThighCm: toStr(body.rightThighCm),
        notes: body.notes as string | undefined,
      });

      // Advance the CLIENT's measurement streak — error-tolerant, the
      // measurement already committed.
      await safeEvaluateStreaks(clientId, "measurement_logged", new Date());

      ctx.set.status = 201;
      return { data: measurement };
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
