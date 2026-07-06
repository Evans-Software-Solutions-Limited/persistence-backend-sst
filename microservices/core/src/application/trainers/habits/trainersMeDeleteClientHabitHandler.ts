import Elysia, { t } from "elysia";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { disableClientHabitOnBehalf } from "./disableClientHabit";

/**
 * DELETE /trainers/me/clients/:clientId/habits/:category — a coach disables a
 * habit IT assigned (18-habit-setup Phase 18.3; design.md § 3.2). 403 when the
 * habit is self-set or another coach's. Soft-disable + audit in one transaction
 * via the shared `disableClientHabitOnBehalf` core.
 */
export const trainersMeDeleteClientHabitHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .delete(
    "/trainers/me/clients/:clientId/habits/:category",
    async (ctx) => {
      const { sub: trainerId } = getUser(ctx);
      const { clientId, category } = ctx.params as {
        clientId: string;
        category: string;
      };

      const result = await disableClientHabitOnBehalf({
        trainerId,
        clientId,
        category,
      });

      if (!result.ok) {
        ctx.set.status = result.status;
        return result.body;
      }
      return { data: { category, disabled: true } };
    },
    {
      params: t.Object({
        clientId: t.String({ minLength: 1 }),
        category: t.String(),
      }),
    },
  );
