import Elysia from "elysia";
import { AiUsageLogRepository } from "./aiUsageLogRepository";

export const AiUsageLogService = new Elysia({
  name: "AiUsageLogService",
}).decorate("AiUsageLogRepository", new AiUsageLogRepository());
