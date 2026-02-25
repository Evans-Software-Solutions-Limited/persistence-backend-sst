import Elysia from "elysia";
import { ExerciseRepository } from "../../repositories/exerciseRepository";

export const ExercisesGetService = new Elysia().decorate(
  "ExerciseRepository",
  new ExerciseRepository(),
);
