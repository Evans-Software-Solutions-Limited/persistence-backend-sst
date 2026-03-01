import Elysia from "elysia";
import { ProgressRepository } from "./progressRepository";

export const ProgressService = new Elysia({ name: "ProgressService" }).decorate(
  "ProgressRepository",
  new ProgressRepository(),
);
