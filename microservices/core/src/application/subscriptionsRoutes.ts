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
// FOUNDING-OFFER: referral attribution rides in this sub-app (subscription-
// adjacent) rather than adding a root `.use()` — see the TS2589 note above.
import { referralsHandler } from "./referrals/referralsHandler";
// FOUNDING-OFFER: the internal admin sub-app ALSO mounts here. Adding it as a
// root `.use()` in api.ts tipped the root chain into TS2589 (measured
// 2026-09-03); nesting one level down keeps the depth cost off the root.
import { adminRoutes } from "./adminRoutes";

export const subscriptionsRoutes = new Elysia()
  .use(subscriptionsTiersHandler)
  .use(subscriptionsMeHandler)
  .use(subscriptionsSyncHandler)
  .use(subscriptionsCreateHandler)
  .use(subscriptionsCancelHandler)
  .use(referralsHandler)
  .use(adminRoutes);
