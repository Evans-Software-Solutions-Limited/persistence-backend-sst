import Elysia from "elysia";
import { ExerciseService } from "../../repositories/exerciseService";

export const categoriesHandler = new Elysia()
  .use(ExerciseService)
  .get("/exercises/categories", async (ctx) => {
    const categories = await ctx.ExerciseRepository.getCategories();
    return { data: categories };
  });
