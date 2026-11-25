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
      // Numeric fields below are validated by the route schema as
      // `string | number`, hence the `as string | number` before `String()`.

      // Optional client-supplied reading time (HealthKit→server push imports
      // readings taken in the past — stamping NOW would put them on the wrong
      // trend day). Absent → the column's DEFAULT NOW() applies, unchanged.
      // Future-dated readings are rejected (small skew allowance): a future
      // `measured_at` would pollute the trend series for every later fetch.
      let measuredAt: Date | undefined;
      if (body.measuredAt !== undefined) {
        const parsed = new Date(body.measuredAt as string);
        if (
          Number.isNaN(parsed.getTime()) ||
          parsed.getTime() > Date.now() + 5 * 60 * 1000
        ) {
          ctx.set.status = 400;
          return {
            code: "invalid_measured_at",
            message:
              "measuredAt must be an ISO 8601 timestamp, not in the future",
          };
        }
        measuredAt = parsed;
      }

      const measurement = await ctx.MeasurementRepository.create(userId, {
        ...(measuredAt !== undefined ? { measuredAt } : {}),
        weightKg:
          body.weightKg !== undefined
            ? String(body.weightKg as string | number)
            : undefined,
        bodyFatPercentage:
          body.bodyFatPercentage !== undefined
            ? String(body.bodyFatPercentage as string | number)
            : undefined,
        chestCm:
          body.chestCm !== undefined
            ? String(body.chestCm as string | number)
            : undefined,
        waistCm:
          body.waistCm !== undefined
            ? String(body.waistCm as string | number)
            : undefined,
        hipsCm:
          body.hipsCm !== undefined
            ? String(body.hipsCm as string | number)
            : undefined,
        leftArmCm:
          body.leftArmCm !== undefined
            ? String(body.leftArmCm as string | number)
            : undefined,
        rightArmCm:
          body.rightArmCm !== undefined
            ? String(body.rightArmCm as string | number)
            : undefined,
        leftThighCm:
          body.leftThighCm !== undefined
            ? String(body.leftThighCm as string | number)
            : undefined,
        rightThighCm:
          body.rightThighCm !== undefined
            ? String(body.rightThighCm as string | number)
            : undefined,
        notes: body.notes as string | undefined,
      });

      // Advance the measurement streak (STORY-008). Fire-and-forget +
      // error-tolerant — the measurement already committed above. Evaluate at
      // the reading's own time when supplied (a HealthKit import of
      // yesterday's weigh-in credits yesterday's period, not today's).
      await safeEvaluateStreaks(
        userId,
        "measurement_logged",
        measuredAt ?? new Date(),
      );

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
        measuredAt: t.Optional(t.String()),
      }),
    },
  );
