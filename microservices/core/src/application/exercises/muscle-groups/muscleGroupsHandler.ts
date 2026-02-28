import Elysia from "elysia";
import { ExerciseService } from "../../repositories/exerciseService";

export const muscleGroupsHandler = new Elysia()
  .use(ExerciseService)
  .get("/exercises/muscle-groups", async (ctx) => {
    const muscleGroups = await ctx.ExerciseRepository.getMuscleGroups();
    return { data: muscleGroups };
  });
