import { treaty } from "@elysiajs/eden";
import { type CoreApi } from "@persistence/core";

export const api = {
  // TODO(api-split): `CoreApi` is the whole monolithic `core` Elysia app and
  // sits right at Eden's type-instantiation ceiling — a single extra route tips
  // `treaty<CoreApi>` into TS2589 ("excessively deep"). Grouping the route tree
  // into sub-apps (e.g. `subscriptionsRoutes`) bought headroom back once, and
  // this comment used to say the suppression was no longer needed.
  //
  // ⚠ It is needed again as of spec-21 Phase 1 (2026-07-27).
  // `GET /exercises/substitutes` is the route that tipped it. It CANNOT be
  // nested to buy the depth back: it must be registered before the
  // `/exercises/:id` matcher or that matcher captures "substitutes" as a literal
  // id, so it cannot join a late-mounting sub-app. Two nesting variants were
  // measured and both are worse than this suppression — pairing it with
  // `exercisesSearchHandler`, and collapsing the whole ten-route exercise family
  // into one sub-app, each moved the SAME error into `microservices/core`'s own
  // `api.ts`, i.e. from an unused client into the build every other package
  // depends on. Annotating the new handler's response type explicitly (which it
  // is) did not help either: the cost is the extra route in the tree, not the
  // shape of its response.
  //
  // The real fix is the planned API service split (right-sized Elysia services →
  // small per-service types), after which web AND mobile can adopt
  // `treaty<Service>` for real end-to-end type safety. Cheap to carry until
  // then: this client is not consumed anywhere (0 call-sites).
  // @ts-expect-error TS2589 — see above; remove when the API split lands.
  core: treaty<CoreApi>(import.meta.env.VITE_CORE_API_URL),
};
