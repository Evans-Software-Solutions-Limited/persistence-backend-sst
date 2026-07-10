import Elysia, { t } from "elysia";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { assertTrainerCanActForClient } from "../../relationships/assertTrainerCanActForClient";
import { ProgramAssignmentRepository } from "../../repositories/programAssignmentRepository";

/**
 * GET /trainers/me/clients/:clientId/workout-assignments — the coach's OPEN,
 * plan-visible assignments for one client, resolved to concrete workouts
 * (M18). The coach-side "today's session / upcoming" surface that Swap +
 * Start-live act on. Gated read, no audit.
 */
export const trainersClientWorkoutAssignmentsListHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .get(
    "/trainers/me/clients/:clientId/workout-assignments",
    async (ctx) => {
      const { sub: trainerId } = getUser(ctx);
      const { clientId } = ctx.params as { clientId: string };

      const verdict = await assertTrainerCanActForClient(trainerId, clientId);
      if (!verdict.allowed) {
        ctx.set.status = verdict.status;
        return verdict.body;
      }

      const assignments =
        await new ProgramAssignmentRepository().listOpenAssignmentsForClient(
          trainerId,
          clientId,
        );

      return { data: { assignments } };
    },
    {
      params: t.Object({ clientId: t.String({ minLength: 1 }) }),
    },
  );
