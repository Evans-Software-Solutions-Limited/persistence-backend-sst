import Elysia from "elysia";
import { WaterLogRepository } from "./waterLogRepository";

export const WaterLogService = new Elysia({ name: "WaterLogService" }).decorate(
  "WaterLogRepository",
  new WaterLogRepository(),
);
