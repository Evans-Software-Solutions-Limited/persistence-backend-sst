import Elysia from "elysia";
import { Hono } from "hono";
import { handle } from "hono/aws-lambda";
import openapi from "@elysiajs/openapi";

import { getHelloWorldHandler } from "./application/hello-world/get/helloWorldGetHandler";
import { exercisesListHandler } from "./application/exercises/list/exercisesListHandler";
import { exercisesGetHandler } from "./application/exercises/get/exercisesGetHandler";
import { workoutsListHandler } from "./application/workouts/list/workoutsListHandler";
import { workoutsGetHandler } from "./application/workouts/get/workoutsGetHandler";
import { workoutsCreateHandler } from "./application/workouts/create/workoutsCreateHandler";
import { workoutsUpdateHandler } from "./application/workouts/update/workoutsUpdateHandler";
import { workoutsDeleteHandler } from "./application/workouts/delete/workoutsDeleteHandler";

const app = new Elysia()
  .use(openapi())
  .get("/health", () => ({ status: "ok" }))
  .use(exercisesListHandler)
  .use(exercisesGetHandler)
  .use(getHelloWorldHandler)
  .use(workoutsListHandler)
  .use(workoutsGetHandler)
  .use(workoutsCreateHandler)
  .use(workoutsUpdateHandler)
  .use(workoutsDeleteHandler);

export type CoreApi = typeof app;

export const handler = handle(new Hono().mount("/", app.fetch));
