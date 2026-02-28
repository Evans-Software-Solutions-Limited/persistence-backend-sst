import Elysia from "elysia";
import { DashboardRepository } from "./dashboardRepository";

export const DashboardService = new Elysia({
  name: "DashboardService",
}).decorate("DashboardRepository", new DashboardRepository());
