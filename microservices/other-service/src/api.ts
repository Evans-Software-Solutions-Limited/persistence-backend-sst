import Elysia from "elysia";
import { Hono } from "hono";
import { handle } from "hono/aws-lambda";
import openapi from "@elysiajs/openapi";

const app = new Elysia()
  .use(openapi())
  .get("/health", () => ({ status: "ok" }));

export const handler = handle(new Hono().mount("/", app.fetch));
