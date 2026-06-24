import Elysia from "elysia";
import { NutritionEntryRepository } from "./nutritionEntryRepository";

export const NutritionEntryService = new Elysia({
  name: "NutritionEntryService",
}).decorate("NutritionEntryRepository", new NutritionEntryRepository());
