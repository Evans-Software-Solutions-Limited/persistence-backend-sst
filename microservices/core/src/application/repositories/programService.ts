import Elysia from "elysia";
import { ProgramRepository } from "./programRepository";
import { ProgramAssignmentRepository } from "./programAssignmentRepository";

export const ProgramService = new Elysia({ name: "ProgramService" })
  .decorate("ProgramRepository", new ProgramRepository())
  .decorate("ProgramAssignmentRepository", new ProgramAssignmentRepository());
