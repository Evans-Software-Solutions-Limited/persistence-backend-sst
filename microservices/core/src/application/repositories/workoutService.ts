import Elysia from "elysia";
import { WorkoutRepository } from "./workoutRepository";

export const WorkoutService = new Elysia({ name: "WorkoutService" }).decorate(
  "WorkoutRepository",
  new WorkoutRepository(),
);
