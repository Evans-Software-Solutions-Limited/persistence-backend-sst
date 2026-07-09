import Elysia from "elysia";
// Self goals (05-progress-goals / M4) + the shared goal-types catalog, grouped
// into a single sub-app so api.ts adds ONE `.use()` to the root chain rather
// than six. Beyond tidiness this keeps the Eden Treaty type instantiation in
// packages/web under TS's depth ceiling — a long flat `.use()` chain trips
// TS2589 once the app gets large (mirrors nutritionRoutes / trainersOnBehalfRoutes).
import { goalsCreateHandler } from "./goals/create/goalsCreateHandler";
import { goalsListHandler } from "./goals/list/goalsListHandler";
import { goalsGetHandler } from "./goals/get/goalsGetHandler";
import { goalsUpdateHandler } from "./goals/update/goalsUpdateHandler";
import { goalsDeleteHandler } from "./goals/delete/goalsDeleteHandler";
import { goalTypesListHandler } from "./goals/types/goalTypesListHandler";

export const goalsRoutes = new Elysia()
  // GET /goal-types — the shared reference catalog. A distinct static path from
  // /goals and /goals/:id, so it never shadows the CRUD routes; mounted first
  // for good measure (static segments match before the terminal :id anyway).
  .use(goalTypesListHandler)
  .use(goalsCreateHandler)
  .use(goalsListHandler)
  .use(goalsGetHandler)
  .use(goalsUpdateHandler)
  .use(goalsDeleteHandler);
