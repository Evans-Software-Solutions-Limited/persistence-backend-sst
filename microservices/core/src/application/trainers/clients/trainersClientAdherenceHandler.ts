import Elysia, { t } from "elysia";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { resolveCoachScope } from "../../relationships/resolveCoachScope";
import { auditClientDataRead } from "../../relationships/auditClientDataRead";
import { clientAdherenceReport } from "../../adherence/coachAdherence";

/**
 * GET /trainers/me/clients/:clientId/adherence?window=7d|28d — the full
 * `AdherenceReport` for one client (PER-114, design B D3): the C3 Overview
 * band and the C3.2 per-day list. New resource, so no old bundle reads it.
 *
 * `resolveCoachScope` gates it (role, active relationship, neither account
 * deleted) and supplies the caller's own settings, so with two coaches each
 * sees their own training target and the same calories. A read, so no
 * `trainer_actions_audit` row, but logged to the coach read-audit like the
 * client detail aggregate. `window` defaults to 7d.
 */
export const trainersClientAdherenceHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .get(
    "/trainers/me/clients/:clientId/adherence",
    async (ctx) => {
      const { sub: trainerId } = getUser(ctx);
      const { clientId } = ctx.params;

      const result = await resolveCoachScope(trainerId, clientId);
      if (!result.allowed) {
        ctx.set.status = result.status;
        return result.body;
      }

      await auditClientDataRead({
        trainerId,
        clientId,
        dataCategory: "client_adherence",
        route: "/trainers/me/clients/:clientId/adherence",
      }).catch(() => {});

      const data = await clientAdherenceReport(
        result.scope,
        ctx.query.window ?? "7d",
      );
      return { data };
    },
    {
      params: t.Object({ clientId: t.String({ minLength: 1 }) }),
      query: t.Object({
        window: t.Optional(t.Union([t.Literal("7d"), t.Literal("28d")])),
      }),
    },
  );
