import Elysia from "elysia";
import { ExerciseService } from "../../repositories/exerciseService";

export const equipmentHandler = new Elysia()
  .use(ExerciseService)
  .get("/exercises/equipment", async (ctx) => {
    const equipment = await ctx.ExerciseRepository.getEquipmentTypes();
    return { data: equipment };
  });
