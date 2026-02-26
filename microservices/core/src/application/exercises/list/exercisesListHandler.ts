import Elysia, { t } from "elysia";
import { ExerciseService } from "../../repositories/exerciseService";

export const exercisesListHandler = new Elysia().use(ExerciseService).get(
  "/exercises",
  async (ctx) => {
    const { muscleGroup, difficulty, category, search, limit, offset } =
      ctx.query;

    const exercises = await ctx.ExerciseRepository.list({
      muscleGroup,
      difficulty,
      category,
      search,
      limit: limit ?? 20,
      offset: offset ?? 0,
    });

    return { data: exercises };
  },
  {
    query: t.Object({
      muscleGroup: t.Optional(t.String({ format: "uuid" })),
      difficulty: t.Optional(t.String()),
      category: t.Optional(t.String()),
      search: t.Optional(t.String()),
      limit: t.Optional(t.Numeric()),
      offset: t.Optional(t.Numeric()),
    }),
  },
);
