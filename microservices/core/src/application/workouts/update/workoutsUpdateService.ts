import Elysia from "elysia";
import { WorkoutRepository } from "../../repositories/workoutRepository";

export const WorkoutsUpdateService = new Elysia().decorate(
  "WorkoutRepository",
  new WorkoutRepository(),
);
