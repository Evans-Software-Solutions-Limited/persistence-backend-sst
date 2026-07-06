import Elysia, { t } from "elysia";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { HabitService } from "../../repositories/habitService";
import { assertTrainerCanActForClient } from "../../relationships/assertTrainerCanActForClient";
import { parseWindowDays } from "../../habits/listHabitCompletionsHandler";

/**
 * GET /trainers/me/clients/:clientId/habit-completions — a coach reads a
 * client's habit completion history for the trainer dashboard (18-habit-setup
 * Phase 18.3 — T-18.3.2; design.md § 3.2, STORY-006 AC 6.5). Same wire shape as
 * the self `GET /habit-completions` (optional `goalId`, `window=Nd`). Reads
 * aren't audited (cross-cuts § 1.4). Auth via the shared gate (cross-cuts § 1.3);
 * values come FROM THE DB (locked decision 7 — trainers never touch HealthKit).
 */
export const trainersMeListClientHabitCompletionsHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(HabitService)
  .get(
    "/trainers/me/clients/:clientId/habit-completions",
    async (ctx) => {
      const { sub: trainerId } = getUser(ctx);
      const { clientId } = ctx.params as { clientId: string };

      const verdict = await assertTrainerCanActForClient(trainerId, clientId);
      if (!verdict.allowed) {
        ctx.set.status = verdict.status;
        return verdict.body;
      }

      const { goalId, window } = ctx.query;
      const completions = await ctx.HabitRepository.list(clientId, {
        goalId,
        windowDays: parseWindowDays(window),
      });
      return { data: completions };
    },
    {
      params: t.Object({ clientId: t.String({ minLength: 1 }) }),
      query: t.Object({
        goalId: t.Optional(t.String()),
        window: t.Optional(t.String()),
      }),
    },
  );
