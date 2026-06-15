import Elysia from "elysia";
import { StreakRepository } from "./streakRepository";

export const StreakReadService = new Elysia({
  name: "StreakReadService",
}).decorate("StreakRepository", new StreakRepository());
