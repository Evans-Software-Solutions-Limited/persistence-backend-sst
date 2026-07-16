import Elysia from "elysia";
import { SleepRepository } from "./sleepRepository";

export const SleepService = new Elysia({
  name: "SleepService",
}).decorate("SleepRepository", new SleepRepository());
