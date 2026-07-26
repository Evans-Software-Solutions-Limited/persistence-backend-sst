import Elysia, { t } from "elysia";
import { WorkoutService } from "../../repositories/workoutService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/**
 * GET /workouts/:id/variations — the caller's Loadout variations of this parent.
 *
 * Loadout (spec-21) AC-6.1 / AC-6.2. Backs the parent detail's "Saved setups"
 * list: gym name, kit snapshot, swap count and age per variation.
 *
 * TWO gates, both necessary:
 *   1. `findReadableWorkout` on the PARENT — you can only list setups for a workout
 *      you're allowed to open (own / public / friends / assigned). Read, not
 *      own, per AC-1.2.
 *   2. `created_by = caller` inside `listVariations` — two athletes adapting the
 *      same coach-assigned parent must never see each other's setups, and a
 *      coach must never see a client's variation of a workout the coach wrote.
 *
 * Gate 1 alone would leak; gate 2 alone would let a caller enumerate variations
 * under a parent they cannot see. Neither is redundant.
 *
 * This endpoint is NOT entitlement-gated. Reading setups you already own must
 * keep working if a subscription lapses — losing access to your own saved
 * training data on a failed payment is the kind of thing that generates refunds.
 * CREATING a variation is what costs money, and that is gated.
 */
export const workoutVariationsListHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(WorkoutService)
  .get(
    "/workouts/:id/variations",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const parentId = ctx.params.id;

      const parent = await ctx.WorkoutRepository.findReadableWorkout(
        parentId,
        userId,
      );
      if (!parent) {
        // One 404 for "missing" and "not allowed" alike — no 403/404
        // distinction, so a caller can't probe for workouts they can't see.
        ctx.set.status = 404;
        return { code: "not_found", message: "Workout not found" };
      }

      const variations = await ctx.WorkoutRepository.listVariations(
        parentId,
        userId,
      );
      return { data: variations };
    },
    { params: t.Object({ id: t.String({ format: "uuid" }) }) },
  );
