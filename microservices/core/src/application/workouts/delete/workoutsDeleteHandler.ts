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

export const workoutsDeleteHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(WorkoutService)
  .delete(
    "/workouts/:id",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const { id } = ctx.params;

      const existing = await ctx.WorkoutRepository.getById(id, userId);
      if (existing?.variationKind === "loadout") {
        const verdict = await assertEntitlement(userId, "loadout");
        if (!verdict.allowed) throw new EntitlementError(verdict, "loadout");
      }

      const success = await ctx.WorkoutRepository.delete(id, userId);

      if (!success) {
        ctx.set.status = 404;
        return { error: "Workout not found" };
      }

      ctx.set.status = 204;
      return new Response(null, { status: 204 });
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  );
