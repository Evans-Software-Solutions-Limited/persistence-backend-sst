import { treaty } from "@elysiajs/eden";
import { type CoreApi } from "@persistence/core";

export const api = {
  // TODO(api-split): `CoreApi` is the whole monolithic `core` Elysia app and
  // sits right at Eden's type-instantiation ceiling — historically a single
  // extra route tipped `treaty<CoreApi>` into TS2589 ("excessively deep") and
  // this call needed a `@ts-expect-error`. Grouping the route tree into
  // sub-apps (e.g. `subscriptionsRoutes`) brought the depth back under the
  // ceiling, so the suppression is no longer needed. If a future route pushes
  // it over again, re-add `// @ts-expect-error TS2589` on the line below. The
  // real fix is the planned API service split (right-sized Elysia services →
  // small per-service types), after which web AND mobile can adopt
  // `treaty<Service>` for real end-to-end type safety. Not yet consumed
  // anywhere (0 call-sites).
  core: treaty<CoreApi>(import.meta.env.VITE_CORE_API_URL),
};
