import Elysia from "elysia";
import { NutritionPreferenceRepository } from "./nutritionPreferenceRepository";

export const NutritionPreferenceService = new Elysia({
  name: "NutritionPreferenceService",
}).decorate(
  "NutritionPreferenceRepository",
  new NutritionPreferenceRepository(),
);
