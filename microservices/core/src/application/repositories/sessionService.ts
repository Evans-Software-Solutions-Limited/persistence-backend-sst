import Elysia from "elysia";
import { SessionRepository } from "./sessionRepository";

export const SessionService = new Elysia({ name: "SessionService" }).decorate(
  "SessionRepository",
  new SessionRepository(),
);
