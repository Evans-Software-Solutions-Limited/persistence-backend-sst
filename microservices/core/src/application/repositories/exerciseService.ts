import Elysia from "elysia";
import { ExerciseRepository } from "./exerciseRepository";

export const ExerciseService = new Elysia({ name: "ExerciseService" }).decorate(
  "ExerciseRepository",
  new ExerciseRepository(),
);
