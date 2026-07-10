import Elysia, { t } from "elysia";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { swapClientWorkoutOnBehalf } from "./swapClientWorkout";

/**
 * PATCH /trainers/me/clients/:clientId/workout-assignments/:id — a coach swaps
 * the workout on an OPEN assignment (M18). Authorization + swap + audit +
 * notification live in the shared `swapClientWorkoutOnBehalf` core.
 */
export const trainersClientWorkoutAssignmentsSwapHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .patch(
    "/trainers/me/clients/:clientId/workout-assignments/:id",
    async (ctx) => {
      const { sub: trainerId } = getUser(ctx);
      const { clientId, id: assignmentId } = ctx.params as {
        clientId: string;
        id: string;
      };
      const body = ctx.body as { workoutId: string };

      const result = await swapClientWorkoutOnBehalf({
        trainerId,
        clientId,
        assignmentId,
        body,
      });

      if (!result.ok) {
        ctx.set.status = result.status;
        return result.body;
      }

      return { data: result.assignment };
    },
    {
      params: t.Object({
        clientId: t.String({ minLength: 1 }),
        id: t.String({ minLength: 1 }),
      }),
      body: t.Object({ workoutId: t.String({ minLength: 1 }) }),
    },
  );
