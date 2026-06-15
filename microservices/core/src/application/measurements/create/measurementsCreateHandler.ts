import Elysia, { t } from "elysia";
import { MeasurementService } from "../../repositories/measurementService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { safeEvaluateStreaks } from "../../streaks/evaluate";

export const measurementsCreateHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(MeasurementService)
  .post(
    "/measurements",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const body = ctx.body as Record<string, unknown>;

      const measurement = await ctx.MeasurementRepository.create(userId, {
        weightKg:
          body.weightKg !== undefined ? String(body.weightKg) : undefined,
        bodyFatPercentage:
          body.bodyFatPercentage !== undefined
            ? String(body.bodyFatPercentage)
            : undefined,
        chestCm: body.chestCm !== undefined ? String(body.chestCm) : undefined,
        waistCm: body.waistCm !== undefined ? String(body.waistCm) : undefined,
        hipsCm: body.hipsCm !== undefined ? String(body.hipsCm) : undefined,
        leftArmCm:
          body.leftArmCm !== undefined ? String(body.leftArmCm) : undefined,
        rightArmCm:
          body.rightArmCm !== undefined ? String(body.rightArmCm) : undefined,
        leftThighCm:
          body.leftThighCm !== undefined ? String(body.leftThighCm) : undefined,
        rightThighCm:
          body.rightThighCm !== undefined
            ? String(body.rightThighCm)
            : undefined,
        notes: body.notes as string | undefined,
      });

      // Advance the measurement streak (STORY-008). Fire-and-forget +
      // error-tolerant — the measurement already committed above.
      await safeEvaluateStreaks(userId, "measurement_logged", new Date());

      ctx.set.status = 201;
      return { data: measurement };
    },
    {
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
