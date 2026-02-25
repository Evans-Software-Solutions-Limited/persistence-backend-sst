import Elysia from "elysia";
import { WorkoutRepository } from "../../repositories/workoutRepository";

export const WorkoutsListService = new Elysia().decorate(
  "WorkoutRepository",
  new WorkoutRepository(),
);
