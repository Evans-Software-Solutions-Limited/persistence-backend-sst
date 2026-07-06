import Elysia from "elysia";
// Habit-setup SELF routes (18-habit-setup), grouped into one sub-app so api.ts
// adds a SINGLE `.use()` to the root chain rather than several. Beyond tidiness
// this keeps the Eden Treaty / root type instantiation under TS's depth
// ceiling — a long flat `.use()` chain trips TS2589 (Type instantiation is
// excessively deep) once the app gets large (mirrors `trainersOnBehalfRoutes`
// / `nutritionRoutes`). Adding the holiday handler directly to the root chain
// tipped it over; grouping the two habit-config surfaces here nets it back.
import { habitConfigHandler } from "./habits/config/habitConfigHandler";
import { habitHolidayHandler } from "./habits/holidays/habitHolidayHandler";

export const habitsSelfRoutes = new Elysia()
  .use(habitConfigHandler)
  .use(habitHolidayHandler);
