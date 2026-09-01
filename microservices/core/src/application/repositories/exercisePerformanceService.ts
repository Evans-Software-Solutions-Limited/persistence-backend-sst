import Elysia from "elysia";
import { ExercisePerformanceRepository } from "./exercisePerformanceRepository";

export const ExercisePerformanceService = new Elysia({
  name: "ExercisePerformanceService",
}).decorate(
  "ExercisePerformanceRepository",
  new ExercisePerformanceRepository(),
);
