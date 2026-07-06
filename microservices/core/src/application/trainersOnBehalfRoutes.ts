import Elysia from "elysia";
// Coach Mode Phase 3 (10.3) — trainer on-behalf endpoints, grouped into a
// single sub-app so api.ts adds ONE `.use()` to the root chain rather than
// seven. Beyond tidiness this keeps the Eden Treaty / root type instantiation
// under TS's depth ceiling — a long flat `.use()` chain trips TS2589 (Type
// instantiation is excessively deep) once the app gets large, which is exactly
// what these additions did before the grouping (mirrors `nutritionRoutes`).
//
// All routes live under /trainers/me/clients/:clientId/... Each write goes
// through assertTrainerCanActForClient + auditTrainerAction (same tx) and emits
// a best-effort client notification post-commit (cross-cuts § 1.2/§ 1.4/§ 5).
import { trainersMeLogClientSessionHandler } from "./trainers/sessions/trainersMeLogClientSessionHandler";
import { trainersMeListClientSessionsHandler } from "./trainers/sessions/trainersMeListClientSessionsHandler";
import { trainersMeListClientMeasurementsHandler } from "./trainers/measurements/trainersMeListClientMeasurementsHandler";
import { trainersMeAssignClientGoalHandler } from "./trainers/goals/trainersMeAssignClientGoalHandler";
import { trainersMeListClientGoalsHandler } from "./trainers/goals/trainersMeListClientGoalsHandler";
import { trainersMeUpdateClientGoalHandler } from "./trainers/goals/trainersMeUpdateClientGoalHandler";
import { trainersMeSetClientNutritionTargetHandler } from "./trainers/nutrition/trainersMeSetClientNutritionTargetHandler";

export const trainersOnBehalfRoutes = new Elysia()
  // sessions — POST create + GET list (different methods, no path collision).
  .use(trainersMeLogClientSessionHandler)
  .use(trainersMeListClientSessionsHandler)
  // measurements — POST shipped in Phase 2; this is the parity GET only.
  .use(trainersMeListClientMeasurementsHandler)
  // goals — POST assign, GET list, PUT edit-own (:id). Distinct methods/paths.
  .use(trainersMeAssignClientGoalHandler)
  .use(trainersMeListClientGoalsHandler)
  .use(trainersMeUpdateClientGoalHandler)
  // nutrition target — the ONE nutrition write in the coach surface's scope.
  .use(trainersMeSetClientNutritionTargetHandler);
