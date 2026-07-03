import Elysia, { t } from "elysia";
import { ProgramService } from "../../repositories/programService";
import { TrainerService } from "../../repositories/trainerService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { todayIso } from "./shared";

/**
 * POST /trainers/me/programs — create a programme (specs/19-programs
 * STORY-001). `durationWeeks: null` = INDEFINITE programme; `workoutIds` is
 * the ordered cycle (duplicates allowed, empty = draft shell). 422 when any
 * workout isn't the coach's own or public.
 */
export const trainersProgramsCreateHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(TrainerService)
  .use(ProgramService)
  .post(
    "/trainers/me/programs",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);

      if (!(await ctx.TrainerRepository.isTrainer(userId))) {
        ctx.set.status = 403;
        return { message: "Forbidden" };
      }

      const result = await ctx.ProgramRepository.create(
        userId,
        {
          name: ctx.body.name,
          description: ctx.body.description ?? null,
          durationWeeks: ctx.body.durationWeeks,
          daysPerWeek: ctx.body.daysPerWeek,
          workoutIds: ctx.body.workoutIds,
        },
        todayIso(),
      );

      if ("error" in result) {
        ctx.set.status = 422;
        return {
          code: "invalid_workouts",
          message: "Every workout must be your own or public",
        };
      }

      ctx.set.status = 201;
      return { data: result };
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 120 }),
        description: t.Optional(
          t.Union([t.String({ maxLength: 2000 }), t.Null()]),
        ),
        durationWeeks: t.Union([
          t.Integer({ minimum: 1, maximum: 104 }),
          t.Null(),
        ]),
        daysPerWeek: t.Integer({ minimum: 1, maximum: 7 }),
        workoutIds: t.Array(t.String({ minLength: 1 }), { maxItems: 50 }),
      }),
    },
  );
