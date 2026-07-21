import Elysia from "elysia";
// Subscriptions grouped into a single sub-app so api.ts adds ONE `.use()` to
// the root chain rather than five. Beyond tidiness this keeps the root chain
// under TS's type-instantiation depth ceiling (a long flat `.use()` chain
// trips TS2589 — see nutritionRoutes for the same constraint). Any new
// subscription leaf route MUST join this sub-app, not add a root `.use()`.
import { subscriptionsTiersHandler } from "./subscriptions/tiers/subscriptionsTiersHandler";
import { subscriptionsMeHandler } from "./subscriptions/me/subscriptionsMeHandler";
import { subscriptionsSyncHandler } from "./subscriptions/sync/subscriptionsSyncHandler";
import { subscriptionsCreateHandler } from "./subscriptions/create/subscriptionsCreateHandler";
import { subscriptionsCancelHandler } from "./subscriptions/cancel/subscriptionsCancelHandler";

export const subscriptionsRoutes = new Elysia()
  .use(subscriptionsTiersHandler)
  .use(subscriptionsMeHandler)
  .use(subscriptionsSyncHandler)
  .use(subscriptionsCreateHandler)
  .use(subscriptionsCancelHandler);
