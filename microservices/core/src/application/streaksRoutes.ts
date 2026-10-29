import Elysia from "elysia";
import { getStreaksHandler } from "./progress/getStreaksHandler";
import { useFreezeTokenHandler } from "./progress/useFreezeTokenHandler";

/**
 * Streaks — both routes live under `/users/me/streaks`, grouped into ONE
 * sub-app so api.ts adds a single `.use()` rather than two.
 *
 * Purely a regrouping: no route, guard or ordering changes. It exists because
 * the root `.use()` chain in api.ts is ON TypeScript's instantiation-depth
 * ceiling — adding any one new root route tripped TS2589 on `src/api.ts`
 * outright. Collapsing this pair pays for the async-job spine's `jobsRoutes`
 * slot. Same remedy `loadoutRoutes` and `trainersOnBehalfRoutes` document, and
 * the same reason it matters beyond this package: packages/web's Eden
 * `treaty<CoreApi>` client instantiates the whole route type, so a backend-only
 * change can flip TS2589 in a package with no edited files (see
 * memory/reference_web_eden_couples_to_core_type).
 *
 * Ordering: the literal `GET /users/me/streaks` and the deeper
 * `POST /users/me/streaks/:id/use-token` cannot capture one another — different
 * methods and different depths — so registration order here is not load-bearing.
 */
export const streaksRoutes = new Elysia()
  .use(getStreaksHandler)
  .use(useFreezeTokenHandler);
