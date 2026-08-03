import Elysia from "elysia";
import { AiJobRepository } from "./aiJobRepository";

export const AiJobService = new Elysia({ name: "AiJobService" }).decorate(
  "AiJobRepository",
  new AiJobRepository(),
);
