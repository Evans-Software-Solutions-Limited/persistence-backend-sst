import Elysia, { t } from "elysia";
import { ExerciseService } from "../../repositories/exerciseService";

export const exercisesGetHandler = new Elysia().use(ExerciseService).get(
  "/exercises/:id",
  async (ctx) => {
    const { id } = ctx.params;

    const exercise = await ctx.ExerciseRepository.getById(id);

    if (!exercise) {
      ctx.set.status = 404;
      return { error: "Exercise not found" };
    }

    return { data: exercise };
  },
  {
    params: t.Object({
      id: t.String(),
    }),
  },
);
