import Elysia from "elysia";
import { ExerciseRepository } from "../../repositories/exerciseRepository";

export const ExercisesListService = new Elysia().decorate(
  "ExerciseRepository",
  new ExerciseRepository(),
);
