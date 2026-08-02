import Elysia from "elysia";
import { jobsGetHandler } from "./jobs/jobsGetHandler";

/**
 * The shared async-job spine's routes (`specs/_shared/async-jobs`).
 *
 * A sub-app from the start, for the reason `loadoutRoutes` documents: the root
 * `.use()` chain in api.ts is on TypeScript's instantiation-depth ceiling, and
 * one more root route trips TS2589 there — which lands hardest on packages/web,
 * whose Eden `treaty<CoreApi>` client instantiates the whole route type.
 *
 * Today it holds exactly one route. That is deliberate: polling is uniform
 * across every job kind, but ENQUEUE is not — entitlement, sizing and input
 * validation are all kind-specific, so each feature keeps its own enqueue route
 * on its own path (`POST /programs/:id/loadout/adapt`,
 * `POST /nutrition/plans/week`) and calls the spine's `enqueueJob()` helper.
 * There is deliberately no generic `POST /jobs` for a caller to name its own
 * kind against.
 *
 * `/jobs/:id` is a fully literal prefix no other route uses, so nothing can
 * capture it and this sub-app can mount anywhere in the chain.
 */
export const jobsRoutes = new Elysia().use(jobsGetHandler);
