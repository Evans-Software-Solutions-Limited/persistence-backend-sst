import Elysia from "elysia";
import { UserMealRepository } from "./userMealRepository";

export const UserMealService = new Elysia({
  name: "UserMealService",
}).decorate("UserMealRepository", new UserMealRepository());
