import Elysia from "elysia";
import { ProfileRepository } from "./profileRepository";

export const ProfileService = new Elysia({ name: "ProfileService" }).decorate(
  "ProfileRepository",
  new ProfileRepository(),
);
