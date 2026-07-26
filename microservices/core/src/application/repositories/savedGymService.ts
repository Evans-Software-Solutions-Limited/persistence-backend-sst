import Elysia from "elysia";
import { SavedGymRepository } from "./savedGymRepository";

export const SavedGymService = new Elysia({ name: "SavedGymService" }).decorate(
  "SavedGymRepository",
  new SavedGymRepository(),
);
