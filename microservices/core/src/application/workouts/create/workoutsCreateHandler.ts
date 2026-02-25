import Elysia, { t } from "elysia";
import { WorkoutsCreateService } from "./workoutsCreateService";
import {
  supabaseAuth,
  type SupabaseUser,
} from "@persistence/api-utils/auth/supabaseAuth";

export const workoutsCreateHandler = new Elysia()
  .use(supabaseAuth)
  .use(WorkoutsCreateService)
  .post(
    "/workouts",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (ctx: any) => {
      const user = ctx.user as SupabaseUser;
      const userId = user.sub;

      const { name, description, visibility, estimatedDurationMinutes } =
        ctx.body as {
          name: string;
          description?: string;
          visibility?: "private" | "friends" | "public";
          estimatedDurationMinutes?: number;
        };

      if (!name || name.trim().length === 0) {
        ctx.set.status = 400;
        return { error: "Workout name is required" };
      }

      const workout = await ctx.WorkoutRepository.create(userId, {
        name,
        description: description || null,
        visibility: visibility || "private",
        estimatedDurationMinutes: estimatedDurationMinutes || 30,
      });

      ctx.set.status = 201;
      return { data: workout };
    },
    {
      body: t.Object({
        name: t.String(),
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
