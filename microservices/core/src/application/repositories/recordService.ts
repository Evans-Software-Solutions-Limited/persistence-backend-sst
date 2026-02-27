import Elysia from "elysia";
import { RecordRepository } from "./recordRepository";

export const RecordService = new Elysia({ name: "RecordService" }).decorate(
  "RecordRepository",
  new RecordRepository(),
);
