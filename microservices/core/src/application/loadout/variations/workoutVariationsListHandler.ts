import Elysia, { t } from "elysia";
import { WorkoutService } from "../../repositories/workoutService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import {
  assertEntitlement,
  EntitlementError,
} from "../../entitlement/assertEntitlement";

/**
 * GET /workouts/:id/variations — the caller's Loadout variations of this parent.
 *
 * Loadout (spec-21) AC-6.1 / AC-6.2. Backs the parent detail's "Saved setups"
 * list: gym name, kit snapshot, swap count and age per variation.
 *
 * ONE gate, and it is sufficient: `created_by = caller` inside `listVariations`.
 * Two athletes adapting the same coach-assigned parent must never see each
 * other's setups, and a coach must never see a client's variation of a workout
 * the coach wrote — the ownership filter is what enforces that.
 *
 * ⚠ There is deliberately NO read gate on the parent, and that is a change of
 * mind worth recording. Gating on the parent looked like defence in depth but was
 * (a) redundant — the response contains only rows `created_by = caller`, so an
 * unreadable parent yields `[]` and leaks nothing — and (b) actively harmful,
 * because read access to a parent is REVOCABLE. When a coach ends the
 * relationship (spec-25 deletes the `workout_assignments` row), the athlete's own
 * variations of that workout would have become unreachable from every surface at
 * once: hidden from the library by the `parent_workout_id IS NULL` predicate, and
 * 404 here. The athlete would own training data that no endpoint returns.
 *
 * A missing workout and an unreadable one now both return `200 []`, which also
 * discloses strictly less than the 404/200 split did.
 *
 * Rows are retained after a lapse but locked behind the same Loadout entitlement
 * as creation. Resubscribing restores the list unchanged; nothing is deleted.
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
      const verdict = await assertEntitlement(userId, "loadout");
      if (!verdict.allowed) throw new EntitlementError(verdict, "loadout");

      const variations = await ctx.WorkoutRepository.listVariations(
        parentId,
        userId,
      );
      return { data: variations };
    },
    { params: t.Object({ id: t.String({ format: "uuid" }) }) },
  );
