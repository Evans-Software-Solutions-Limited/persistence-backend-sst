import { treaty } from "@elysiajs/eden";
import { type CoreApi } from "@persistence/core";

export const api = {
  // TODO(api-split): `CoreApi` is the whole monolithic `core` Elysia app and
  // has grown past Eden's type-instantiation ceiling — adding a single route
  // (POST /account/restore) tips `treaty<CoreApi>` into TS2589 ("excessively
  // deep"). The runtime client is fine; only the compile-time type expansion
  // overflows. The fix is the planned API service split (right-sized Elysia
  // services → small per-service types), after which web AND mobile can adopt
  // `treaty<Service>` for real end-to-end type safety. Until then this call is
  // not yet consumed anywhere (0 call-sites), so the suppression costs nothing.
  // Remove this directive once the split lands.
  // @ts-expect-error TS2589 — see TODO(api-split) above.
  core: treaty<CoreApi>(import.meta.env.VITE_CORE_API_URL),
};
