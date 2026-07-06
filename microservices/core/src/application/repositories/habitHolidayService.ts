import Elysia from "elysia";
import { HabitHolidayRepository } from "./habitHolidayRepository";

/** Decorates the context with a HabitHolidayRepository (18-habit-setup). */
export const HabitHolidayService = new Elysia({
  name: "HabitHolidayService",
}).decorate("HabitHolidayRepository", new HabitHolidayRepository());
