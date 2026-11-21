import Elysia from "elysia";
import {
  nutritionMealPlansHandlers,
  trainerMealPlanLibraryHandlers,
} from "./mealPlansHandlers";
import {
  coachMealPlanAssignmentHandlers,
  shoppingListHandlers,
} from "./coachMealPlansHandlers";

/**
 * Design D (PER-118) — every list meal-plan route, grouped so
 * `nutritionRoutes` adds ONE `.use()` (the root chain is at TS2589's ceiling).
 * Handlers define absolute paths, so grouping adds no prefix. The coach
 * paths (`/trainers/me/...`) live here rather than in `coachingRoutes` so the
 * coaching sub-app shared with other tickets is untouched.
 */
export const mealPlanRoutes = new Elysia()
  .use(nutritionMealPlansHandlers)
  .use(trainerMealPlanLibraryHandlers)
  .use(coachMealPlanAssignmentHandlers)
  .use(shoppingListHandlers);
