import Elysia from "elysia";
import { devicesRegisterHandler } from "./devices/register/devicesRegisterHandler";
import { devicesUnregisterHandler } from "./devices/unregister/devicesUnregisterHandler";

/**
 * Device push-token routes — `POST /devices/register` and
 * `POST /devices/unregister` grouped into ONE sub-app so api.ts adds a single
 * `.use()` rather than two.
 *
 * Purely a regrouping: no route or guard changes. The root `.use()` chain in
 * api.ts sits on TypeScript's instantiation-depth ceiling, and adding the
 * unregister route as its own root slot tripped TS2589 on `src/api.ts` — same
 * remedy `streaksRoutes` / `loadoutRoutes` document.
 *
 * Ordering: two distinct literal paths, so registration order is not
 * load-bearing.
 */
export const devicesRoutes = new Elysia()
  .use(devicesRegisterHandler)
  .use(devicesUnregisterHandler);
