import Elysia, { t } from "elysia";
import { MeasurementService } from "../../repositories/measurementService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

export const measurementsListHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(MeasurementService)
  .get(
    "/measurements",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const { limit = "20", offset = "0" } = ctx.query as Record<
        string,
        string
      >;

      const measurements = await ctx.MeasurementRepository.list(
        userId,
        parseInt(limit, 10),
        parseInt(offset, 10),
      );

      return { data: measurements };
    },
    {
      query: t.Object({
        limit: t.Optional(t.String()),
        offset: t.Optional(t.String()),
      }),
    },
  );
