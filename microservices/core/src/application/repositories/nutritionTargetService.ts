import Elysia from "elysia";
import { NutritionTargetRepository } from "./nutritionTargetRepository";

export const NutritionTargetService = new Elysia({
  name: "NutritionTargetService",
}).decorate("NutritionTargetRepository", new NutritionTargetRepository());
