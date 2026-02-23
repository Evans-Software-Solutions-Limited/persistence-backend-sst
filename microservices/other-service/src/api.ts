import Elysia from "elysia";
import { Hono } from "hono";
import { handle } from "hono/aws-lambda";

import { getHelloWorldHandler } from "./application/hello-world/get/helloWorldGetHandler";
import openapi from "@elysiajs/openapi";

const app = new Elysia().use(openapi()).use(getHelloWorldHandler);

export const handler = handle(new Hono().mount("/", app.fetch));
