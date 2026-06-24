import Elysia from "elysia";
import { HabitConfigRepository } from "./habitConfigRepository";

/** Decorates the context with a HabitConfigRepository (18-habit-setup). */
export const HabitConfigService = new Elysia({
  name: "HabitConfigService",
}).decorate("HabitConfigRepository", new HabitConfigRepository());
