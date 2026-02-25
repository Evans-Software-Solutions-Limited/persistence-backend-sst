import Elysia, { t } from "elysia";
import { ExercisesListService } from "./exercisesListService";

export const exercisesListHandler = new Elysia().use(ExercisesListService).get(
  "/exercises",
  async (ctx) => {
    const { muscleGroup, difficulty, category, search, limit, offset } =
      ctx.query;

    const exercises = await ctx.ExerciseRepository.list({
      muscleGroup,
      difficulty,
      category,
      search,
      limit: limit ? parseInt(limit, 10) : 20,
      offset: offset ? parseInt(offset, 10) : 0,
    });

    return { data: exercises };
  },
  {
    query: t.Object({
      muscleGroup: t.Optional(t.String()),
      difficulty: t.Optional(t.String()),
      category: t.Optional(t.String()),
      search: t.Optional(t.String()),
      limit: t.Optional(t.String()),
      offset: t.Optional(t.String()),
    }),
  },
);
