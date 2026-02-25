import Elysia from "elysia";
import { WorkoutRepository } from "../../repositories/workoutRepository";

export const WorkoutsDeleteService = new Elysia().decorate(
  "WorkoutRepository",
  new WorkoutRepository(),
);
