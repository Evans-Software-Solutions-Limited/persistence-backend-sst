import Elysia from "elysia";
import { Hono } from "hono";
import { handle } from "hono/aws-lambda";
import openapi from "@elysiajs/openapi";

import { coreErrorHandler } from "./shared/errorHandler";
import { exercisesListHandler } from "./application/exercises/list/exercisesListHandler";
import { exercisesGetHandler } from "./application/exercises/get/exercisesGetHandler";
import { exercisesCreateHandler } from "./application/exercises/create/exercisesCreateHandler";
import { exercisesUpdateHandler } from "./application/exercises/update/exercisesUpdateHandler";
import { exercisesDeleteHandler } from "./application/exercises/delete/exercisesDeleteHandler";
import { muscleGroupsHandler } from "./application/exercises/muscle-groups/muscleGroupsHandler";
import { equipmentHandler } from "./application/exercises/equipment/equipmentHandler";
import { categoriesHandler } from "./application/exercises/categories/categoriesHandler";
import { workoutsListHandler } from "./application/workouts/list/workoutsListHandler";
import { workoutsGetHandler } from "./application/workouts/get/workoutsGetHandler";
import { workoutsCreateHandler } from "./application/workouts/create/workoutsCreateHandler";
import { workoutsUpdateHandler } from "./application/workouts/update/workoutsUpdateHandler";
import { workoutsDeleteHandler } from "./application/workouts/delete/workoutsDeleteHandler";
import { profilesGetHandler } from "./application/profiles/get/profilesGetHandler";
import { profilesUpdateHandler } from "./application/profiles/update/profilesUpdateHandler";
import { sessionsCreateHandler } from "./application/sessions/create/sessionsCreateHandler";
import { sessionsListHandler } from "./application/sessions/list/sessionsListHandler";
import { sessionsGetHandler } from "./application/sessions/get/sessionsGetHandler";
import { sessionsUpdateHandler } from "./application/sessions/update/sessionsUpdateHandler";
import { sessionsDeleteHandler } from "./application/sessions/delete/sessionsDeleteHandler";
import { sessionExercisesCreateHandler } from "./application/sessions/exercises/create/sessionExercisesCreateHandler";
import { sessionExercisesGetHandler } from "./application/sessions/exercises/get/sessionExercisesGetHandler";
import { sessionExercisesDeleteHandler } from "./application/sessions/exercises/delete/sessionExercisesDeleteHandler";
import { setsCreateHandler } from "./application/sessions/sets/create/setsCreateHandler";
import { setsGetHandler } from "./application/sessions/sets/get/setsGetHandler";
import { setsUpdateHandler } from "./application/sessions/sets/update/setsUpdateHandler";
import { setsDeleteHandler } from "./application/sessions/sets/delete/setsDeleteHandler";
import { recordsListHandler } from "./application/records/list/recordsListHandler";
import { measurementsCreateHandler } from "./application/measurements/create/measurementsCreateHandler";
import { measurementsListHandler } from "./application/measurements/list/measurementsListHandler";
import { goalsCreateHandler } from "./application/goals/create/goalsCreateHandler";
import { goalsListHandler } from "./application/goals/list/goalsListHandler";
import { goalsGetHandler } from "./application/goals/get/goalsGetHandler";
import { goalsUpdateHandler } from "./application/goals/update/goalsUpdateHandler";
import { goalsDeleteHandler } from "./application/goals/delete/goalsDeleteHandler";
import { dashboardHandler } from "./application/dashboard/dashboardHandler";
import { progressStatsHandler } from "./application/progress/progressStatsHandler";
import { progressRecordsHandler } from "./application/progress/progressRecordsHandler";
import { progressHistoryHandler } from "./application/progress/progressHistoryHandler";

const app = new Elysia()
  .use(coreErrorHandler)
  .use(openapi())
  .get("/health", () => ({ status: "ok" }))
  .use(exercisesListHandler)
  .use(exercisesGetHandler)
  .use(exercisesCreateHandler)
  .use(exercisesUpdateHandler)
  .use(exercisesDeleteHandler)
  .use(muscleGroupsHandler)
  .use(equipmentHandler)
  .use(categoriesHandler)
  .use(workoutsListHandler)
  .use(workoutsGetHandler)
  .use(workoutsCreateHandler)
  .use(workoutsUpdateHandler)
  .use(workoutsDeleteHandler)
  .use(profilesGetHandler)
  .use(profilesUpdateHandler)
  .use(sessionsCreateHandler)
  .use(sessionsListHandler)
  .use(sessionsGetHandler)
  .use(sessionsUpdateHandler)
  .use(sessionsDeleteHandler)
  .use(sessionExercisesCreateHandler)
  .use(sessionExercisesGetHandler)
  .use(sessionExercisesDeleteHandler)
  .use(setsCreateHandler)
  .use(setsGetHandler)
  .use(setsUpdateHandler)
  .use(setsDeleteHandler)
  .use(recordsListHandler)
  .use(measurementsCreateHandler)
  .use(measurementsListHandler)
  .use(goalsCreateHandler)
  .use(goalsListHandler)
  .use(goalsGetHandler)
  .use(goalsUpdateHandler)
  .use(goalsDeleteHandler)
  .use(dashboardHandler)
  .use(progressStatsHandler)
  .use(progressRecordsHandler)
  .use(progressHistoryHandler);

export type CoreApi = typeof app;

export const handler = handle(new Hono().mount("/", app.fetch));
