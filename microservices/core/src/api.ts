import Elysia from "elysia";
import { Hono } from "hono";
import { handle } from "hono/aws-lambda";
import openapi from "@elysiajs/openapi";

import { supabaseAuth } from "@persistence/api-utils/auth/supabaseAuth";
import { getHelloWorldHandler } from "./application/hello-world/get/helloWorldGetHandler";

const app = new Elysia()
  .use(openapi())
  .get("/health", () => ({ status: "ok" }))
  .use(supabaseAuth)
  .use(getHelloWorldHandler);

export type CoreApi = typeof app;

export const handler = handle(new Hono().mount("/", app.fetch));
