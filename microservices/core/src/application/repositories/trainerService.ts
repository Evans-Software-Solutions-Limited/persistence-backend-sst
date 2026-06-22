import Elysia from "elysia";
import { TrainerRepository } from "./trainerRepository";

export const TrainerService = new Elysia({ name: "TrainerService" }).decorate(
  "TrainerRepository",
  new TrainerRepository(),
);
