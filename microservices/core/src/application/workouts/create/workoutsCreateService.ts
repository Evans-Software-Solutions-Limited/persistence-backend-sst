import Elysia from "elysia";
import { WorkoutRepository } from "../../repositories/workoutRepository";

export const WorkoutsCreateService = new Elysia().decorate(
  "WorkoutRepository",
  new WorkoutRepository(),
);
