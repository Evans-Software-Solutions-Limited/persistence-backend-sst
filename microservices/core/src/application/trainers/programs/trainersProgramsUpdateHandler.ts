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
 * PUT /trainers/me/programs/:id — metadata update + optional atomic
 * structure replace. Structure edits affect FUTURE materialisation only
 * (requirements AC 1.4). 404 covers missing/un-owned; 422 for unreadable
 * workouts.
 */
export const trainersProgramsUpdateHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(TrainerService)
  .use(ProgramService)
  .put(
    "/trainers/me/programs/:id",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);

      if (!(await ctx.TrainerRepository.isTrainer(userId))) {
        ctx.set.status = 403;
        return { message: "Forbidden" };
      }

      const result = await ctx.ProgramRepository.update(
        userId,
        ctx.params.id,
        {
          ...(ctx.body.name !== undefined ? { name: ctx.body.name } : {}),
          ...(ctx.body.description !== undefined
            ? { description: ctx.body.description }
            : {}),
          ...(ctx.body.durationWeeks !== undefined
            ? { durationWeeks: ctx.body.durationWeeks }
            : {}),
          ...(ctx.body.daysPerWeek !== undefined
            ? { daysPerWeek: ctx.body.daysPerWeek }
            : {}),
          ...(ctx.body.workoutIds !== undefined
            ? { workoutIds: ctx.body.workoutIds }
            : {}),
        },
        todayIso(),
      );

      if (result && typeof result === "object" && "error" in result) {
        ctx.set.status = 422;
        return {
          code: "invalid_workouts",
          message: "Every workout must be your own or public",
        };
      }
      if (!result) {
        ctx.set.status = 404;
        return { code: "not_found", message: "Programme not found" };
      }
      return { data: result };
    },
    {
      params: t.Object({ id: t.String({ minLength: 1 }) }),
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
        description: t.Optional(
          t.Union([t.String({ maxLength: 2000 }), t.Null()]),
        ),
        durationWeeks: t.Optional(
          t.Union([t.Integer({ minimum: 1, maximum: 104 }), t.Null()]),
        ),
        daysPerWeek: t.Optional(t.Integer({ minimum: 1, maximum: 7 })),
        workoutIds: t.Optional(
          t.Array(t.String({ minLength: 1 }), { maxItems: 50 }),
        ),
      }),
    },
  );
