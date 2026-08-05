import Elysia from "elysia";
import { MealPlanRepository } from "./mealPlanRepository";

export const MealPlanService = new Elysia({
  name: "MealPlanService",
}).decorate("MealPlanRepository", new MealPlanRepository());
