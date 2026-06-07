import Elysia from "elysia";
import { HabitRepository } from "./habitRepository";

export const HabitService = new Elysia({
  name: "HabitService",
}).decorate("HabitRepository", new HabitRepository());
