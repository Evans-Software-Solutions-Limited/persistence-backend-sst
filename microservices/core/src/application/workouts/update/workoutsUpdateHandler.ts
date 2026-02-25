import Elysia, { t } from "elysia";
import { WorkoutsUpdateService } from "./workoutsUpdateService";
import {
  supabaseAuth,
  type SupabaseUser,
} from "@persistence/api-utils/auth/supabaseAuth";

export const workoutsUpdateHandler = new Elysia()
  .use(supabaseAuth)
  .use(WorkoutsUpdateService)
  .patch(
    "/workouts/:id",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (ctx: any) => {
      const user = ctx.user as SupabaseUser;
      const userId = user.sub;
      const { id } = ctx.params;

      const { name, description, visibility, estimatedDurationMinutes } =
        ctx.body as {
          name?: string;
          description?: string;
          visibility?: "private" | "friends" | "public";
          estimatedDurationMinutes?: number;
        };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updateData: Record<string, any> = {};
      if (name !== undefined) {
        if (name.trim().length === 0) {
          ctx.set.status = 400;
          return { error: "Workout name cannot be empty" };
        }
        updateData.name = name;
      }
      if (description !== undefined) updateData.description = description;
      if (visibility !== undefined) updateData.visibility = visibility;
      if (estimatedDurationMinutes !== undefined)
        updateData.estimatedDurationMinutes = estimatedDurationMinutes;

      const workout = await ctx.WorkoutRepository.update(
        id,
        userId,
        updateData,
      );

      if (!workout) {
        ctx.set.status = 403;
        return {
          error: "Unauthorized: you can only update your own workouts",
        };
      }

      return { data: workout };
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        name: t.Optional(t.String()),
        description: t.Optional(t.String()),
        visibility: t.Optional(
          t.Union([
            t.Literal("private"),
            t.Literal("friends"),
            t.Literal("public"),
          ]),
        ),
        estimatedDurationMinutes: t.Optional(t.Number()),
      }),
    },
  );
