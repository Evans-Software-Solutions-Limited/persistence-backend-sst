import Elysia, { t } from "elysia";
import { WorkoutService } from "../../repositories/workoutService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

// GET /workouts/:id/history — per-workout completed-session stats for the
// CALLING user, feeding the detail hero's market-standard history block
// (LAST DONE / COMPLETED count / AVG TIME + last-session recap). Access is
// gated by the same `canRead` as the detail GET (a null repo return => 404,
// so we never leak the existence of a workout the caller can't read). The
// aggregation is always scoped to `user_id = me` — a client viewing an
// assigned coach workout sees only their OWN history of it.
export const workoutsHistoryHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(WorkoutService)
  .get(
    "/workouts/:id/history",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const { id } = ctx.params;

      const history = await ctx.WorkoutRepository.getHistory(id, userId);

      if (!history) {
        ctx.set.status = 404;
        return { error: "Workout not found" };
      }

      return { data: history };
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  );
