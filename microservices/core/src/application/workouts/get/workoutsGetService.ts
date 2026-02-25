import Elysia from "elysia";
import { WorkoutRepository } from "../../repositories/workoutRepository";

export const WorkoutsGetService = new Elysia().decorate(
  "WorkoutRepository",
  new WorkoutRepository(),
);
