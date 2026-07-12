import Elysia, { t } from "elysia";
import { WorkoutService } from "../../repositories/workoutService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

export const workoutsListHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(WorkoutService)
  .get(
    "/workouts",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const { type, limit, offset, ownerLibraryOnly } = ctx.query;

      const effectiveLimit = limit ?? 20;
      const effectiveOffset = offset ?? 0;

      const result = await ctx.WorkoutRepository.list(userId, {
        type: type ?? "mine",
        limit: effectiveLimit,
        offset: effectiveOffset,
        // Trainers send this to de-crowd their personal My Workouts; only
        // meaningful with type="mine". Absent => unchanged behaviour.
        ownerLibraryOnly: ownerLibraryOnly ?? false,
      });

      const meta: {
        pagination: { limit: number; offset: number; total: number };
        quota?: { used: number; limit: number | null };
      } = {
        pagination: {
          limit: effectiveLimit,
          offset: effectiveOffset,
          total: result.total,
        },
      };

      if (result.quota) {
        meta.quota = result.quota;
      }

      return { data: result.workouts, meta };
    },
    {
      query: t.Object({
        type: t.Optional(
          t.Union([
            t.Literal("mine"),
            t.Literal("assigned"),
            t.Literal("default"),
          ]),
        ),
        limit: t.Optional(t.Numeric()),
        offset: t.Optional(t.Numeric()),
        ownerLibraryOnly: t.Optional(t.BooleanString()),
      }),
    },
  );
