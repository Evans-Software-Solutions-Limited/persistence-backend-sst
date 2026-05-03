import Elysia from "elysia";
import { PersonalRecordsRepository } from "./personalRecordsRepository";

export const PersonalRecordsService = new Elysia({
  name: "PersonalRecordsService",
}).decorate("PersonalRecordsRepository", new PersonalRecordsRepository());
