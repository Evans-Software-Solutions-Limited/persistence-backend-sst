import Elysia from "elysia";
import { MealRepository } from "./mealRepository";

export const MealService = new Elysia({ name: "MealService" }).decorate(
  "MealRepository",
  new MealRepository(),
);
