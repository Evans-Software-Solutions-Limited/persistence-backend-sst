import Elysia from "elysia";
// Loadout (spec-21 § 3) — saved gyms + workout variations, grouped into ONE
// sub-app so api.ts adds a single `.use()` rather than six.
//
// This is not tidiness. The root `.use()` chain in api.ts is at TS's
// instantiation-depth ceiling: spec-25 tripped TS2589 there and had to nest
// inside `trainersOnBehalfRoutes`, and `nutritionRoutes` carries the same
// warning. The ceiling is felt in packages/web, whose Eden `treaty<CoreApi>`
// client instantiates the whole route type — so a backend-only change can flip
// TS2589 in a package with no edited files (see
// memory/reference_web_eden_couples_to_core_type).
//
// Route ordering: every path here is either under a distinct `/saved-gyms`
// prefix or one segment deeper than `/workouts/:id`, so nothing collides with
// the `/workouts/:id` matcher and this sub-app can mount late like its
// precedents.
//
// ⚠ Phase 1's `GET /exercises/substitutes` must NOT join this sub-app. It has to
// be registered BEFORE `exercisesGetHandler` or `/exercises/:id` captures
// "substitutes" as a literal id — and a late-mounting sub-app cannot satisfy
// that ordering. It ships as its own handler next to `exercisesSearchHandler`.
import { savedGymsListHandler } from "./loadout/savedGyms/savedGymsListHandler";
import { savedGymsCreateHandler } from "./loadout/savedGyms/savedGymsCreateHandler";
import { savedGymsUpdateHandler } from "./loadout/savedGyms/savedGymsUpdateHandler";
import { savedGymsDeleteHandler } from "./loadout/savedGyms/savedGymsDeleteHandler";
import { workoutVariationsListHandler } from "./loadout/variations/workoutVariationsListHandler";
import { workoutVariationsCreateHandler } from "./loadout/variations/workoutVariationsCreateHandler";

export const loadoutRoutes = new Elysia()
  // saved gyms — literal /saved-gyms (GET/POST) and parameterised
  // /saved-gyms/:id (PATCH/DELETE) don't collide (different methods).
  .use(savedGymsListHandler)
  .use(savedGymsCreateHandler)
  .use(savedGymsUpdateHandler)
  .use(savedGymsDeleteHandler)
  // variations under a parent workout.
  .use(workoutVariationsListHandler)
  .use(workoutVariationsCreateHandler);
