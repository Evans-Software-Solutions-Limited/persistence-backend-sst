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
import { trainersMeGetClientHabitConfigHandler } from "./trainers/habits/trainersMeGetClientHabitConfigHandler";
import { trainersMeSetClientHabitConfigHandler } from "./trainers/habits/trainersMeSetClientHabitConfigHandler";
import { trainersMeDeleteClientHabitHandler } from "./trainers/habits/trainersMeDeleteClientHabitHandler";
import { trainersMeListClientHabitCompletionsHandler } from "./trainers/habits/trainersMeListClientHabitCompletionsHandler";
import { trainersClientDetailGetHandler } from "./trainers/clients/trainersClientDetailGetHandler";

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
  .use(trainersMeSetClientNutritionTargetHandler)
  // habits (18-habit-setup Phase 18.3) — GET config, PUT config, DELETE, GET
  // completions. Every route asserts trainer + active relationship; writes
  // stamp assigned_by_user_id + a goal_assigned audit row in one transaction.
  .use(trainersMeGetClientHabitConfigHandler)
  .use(trainersMeSetClientHabitConfigHandler)
  .use(trainersMeDeleteClientHabitHandler)
  .use(trainersMeListClientHabitCompletionsHandler)
  // Client Detail read aggregate (Phase 5, 10.5). The bare
  // GET /trainers/me/clients/:clientId. Mounted LAST so the more-specific
  // sibling `…/:clientId/...` routes (habits/config, habits/completions, and —
  // outside this sub-app — active-programme, body-trend, workout-assignments)
  // are registered first; Elysia's radix router matches static segments before
  // the terminal `:clientId` regardless of order, guarded by a route-ordering
  // test.
  .use(trainersClientDetailGetHandler);
