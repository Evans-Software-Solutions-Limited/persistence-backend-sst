import Elysia from "elysia";
import { togetherRoutes } from "./togetherRoutes";
import { socialHandler } from "../social/socialHandler";
import { placesHandler } from "../places/placesHandler";
import { templatesHandler } from "./templatesHandler";
import { captureServerError } from "../../shared/sentry";
import { togetherEnabled, TogetherError } from "./shared";
import { wakeTogether } from "./transport";

export const togetherFeatureRoutes = new Elysia({
  name: "togetherFeatureRoutes",
})
  .onRequest(() => {
    if (!togetherEnabled())
      return new Response(
        JSON.stringify({ error: { code: "NOT_FOUND", message: "Not found" } }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
  })
  .onError(({ error, code, set, request }) => {
    // Domain and schema failures retain their route-specific public contract.
    if (error instanceof TogetherError || code === "VALIDATION") return;
    if (code === "PARSE") {
      set.status = 400;
      return { error: { code: "INVALID_SCHEMA", message: "Invalid request" } };
    }
    if (code === "NOT_FOUND") {
      set.status = 404;
      return { error: { code: "NOT_FOUND", message: "Not found" } };
    }
    captureServerError(error, {
      path: new URL(request.url).pathname,
      method: request.method,
    });
    set.status = 500;
    return {
      error: { code: "INTERNAL_ERROR", message: "Unable to complete request" },
    };
  })
  .onAfterHandle(async ({ request }) => {
    const path = new URL(request.url).pathname;
    if (
      request.method !== "GET" &&
      (path.startsWith("/social/") || path.startsWith("/together/templates"))
    )
      await wakeTogether();
  })
  .use(togetherRoutes)
  .use(socialHandler)
  .use(placesHandler)
  .use(templatesHandler);

export type TogetherApi = typeof togetherFeatureRoutes;
