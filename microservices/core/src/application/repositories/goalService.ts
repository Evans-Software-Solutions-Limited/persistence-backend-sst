import Elysia from "elysia";
import { GoalRepository } from "./goalRepository";

export const GoalService = new Elysia({ name: "GoalService" }).decorate(
  "GoalRepository",
  new GoalRepository(),
);
