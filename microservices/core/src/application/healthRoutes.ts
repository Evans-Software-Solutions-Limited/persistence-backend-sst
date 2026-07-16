import Elysia from "elysia";
// specs/20-sleep-quicklog (PR-A backend) — grouped into a single sub-app so
// api.ts adds ONE `.use()` to the root chain rather than two, matching the
// nutritionRoutes/trainersOnBehalfRoutes precedent: a long flat `.use()`
// chain on the root Elysia app trips TS2589 ("Type instantiation is
// excessively deep") once the app gets large enough.
import { healthSleepPostHandler } from "./health/sleep/post/healthSleepPostHandler";
import { healthSleepGetHandler } from "./health/sleep/get/healthSleepGetHandler";

export const healthRoutes = new Elysia()
  .use(healthSleepPostHandler)
  .use(healthSleepGetHandler);
