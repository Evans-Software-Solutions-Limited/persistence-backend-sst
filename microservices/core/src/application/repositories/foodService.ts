import Elysia from "elysia";
import { FoodRepository } from "./foodRepository";

export const FoodService = new Elysia({ name: "FoodService" }).decorate(
  "FoodRepository",
  new FoodRepository(),
);
