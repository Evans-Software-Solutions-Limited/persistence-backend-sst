import Elysia, { t } from "elysia";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { MeasurementService } from "../../repositories/measurementService";
import { assertTrainerCanActForClient } from "../../relationships/assertTrainerCanActForClient";

/**
 * GET /trainers/me/clients/:clientId/measurements — parity read (cross-cuts
 * § 1.2). The on-behalf POST shipped in Phase 2; this is the new parity GET
 * letting a coach list a client's body measurements (newest-first). Same wire
 * shape as the self measurement list. Reads are NOT audited (cross-cuts § 1.4).
 * Authorization via the shared `assertTrainerCanActForClient` gate
 * (cross-cuts § 1.3).
 */
export const trainersMeListClientMeasurementsHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(MeasurementService)
  .get(
    "/trainers/me/clients/:clientId/measurements",
    async (ctx) => {
      const { sub: trainerId } = getUser(ctx);
      const { clientId } = ctx.params as { clientId: string };

      const verdict = await assertTrainerCanActForClient(trainerId, clientId);
      if (!verdict.allowed) {
        ctx.set.status = verdict.status;
        return verdict.body;
      }

      const { limit, offset } = ctx.query;
      const measurements = await ctx.MeasurementRepository.list(
        clientId,
        limit ?? 20,
        offset ?? 0,
      );

      return { data: measurements };
    },
    {
      params: t.Object({ clientId: t.String({ minLength: 1 }) }),
      query: t.Object({
        limit: t.Optional(t.Numeric()),
        offset: t.Optional(t.Numeric()),
      }),
    },
  );
