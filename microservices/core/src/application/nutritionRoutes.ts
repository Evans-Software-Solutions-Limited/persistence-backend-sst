import Elysia from "elysia";
// M9 — nutrition (Fuel) Tier A. Grouped into a single sub-app so api.ts adds
// ONE `.use()` to the root chain rather than ~22. Beyond tidiness this keeps
// the Eden Treaty type instantiation in packages/web under TS's depth ceiling
// (a long flat `.use()` chain trips TS2589 once the app gets large).
import { nutritionTodayHandler } from "./nutrition/today/nutritionTodayHandler";
import { nutritionEntriesListHandler } from "./nutrition/entries/list/nutritionEntriesListHandler";
import { nutritionEntriesCreateHandler } from "./nutrition/entries/create/nutritionEntriesCreateHandler";
import { nutritionEntriesUpdateHandler } from "./nutrition/entries/update/nutritionEntriesUpdateHandler";
import { nutritionEntriesDeleteHandler } from "./nutrition/entries/delete/nutritionEntriesDeleteHandler";
import { nutritionTargetsGetHandler } from "./nutrition/targets/get/nutritionTargetsGetHandler";
import { nutritionTargetsSetHandler } from "./nutrition/targets/set/nutritionTargetsSetHandler";
import { nutritionWaterGetHandler } from "./nutrition/water/get/nutritionWaterGetHandler";
import { nutritionWaterPatchHandler } from "./nutrition/water/patch/nutritionWaterPatchHandler";
import { nutritionBarcodeResolveHandler } from "./nutrition/barcode/nutritionBarcodeResolveHandler";
import { nutritionAiEstimateHandler } from "./nutrition/ai/estimate/nutritionAiEstimateHandler";
import { nutritionAiEstimateTextHandler } from "./nutrition/ai/estimateText/nutritionAiEstimateTextHandler";
import { nutritionAiExtractRecipeHandler } from "./nutrition/ai/extractRecipe/nutritionAiExtractRecipeHandler";
import { nutritionAiResolveIngredientHandler } from "./nutrition/ai/resolveIngredient/nutritionAiResolveIngredientHandler";
import { foodsListHandler } from "./foods/list/foodsListHandler";
import { foodsCreateHandler } from "./foods/create/foodsCreateHandler";
import { recipesListHandler } from "./recipes/list/recipesListHandler";
import { recipesCreateHandler } from "./recipes/create/recipesCreateHandler";
import { recipesImportHandler } from "./recipes/import/recipesImportHandler";
import { recipesGetHandler } from "./recipes/get/recipesGetHandler";
import { recipesUpdateHandler } from "./recipes/update/recipesUpdateHandler";
import { recipesDeleteHandler } from "./recipes/delete/recipesDeleteHandler";
import { mealsListHandler } from "./meals/list/mealsListHandler";
import { mealsCreateHandler } from "./meals/create/mealsCreateHandler";
import { mealsGetHandler } from "./meals/get/mealsGetHandler";
import { mealsUpdateHandler } from "./meals/update/mealsUpdateHandler";
import { mealsDeleteHandler } from "./meals/delete/mealsDeleteHandler";

export const nutritionRoutes = new Elysia()
  .use(nutritionTodayHandler)
  // entries — literal /nutrition/entries (GET/POST) and parameterised
  // /nutrition/entries/:id (PUT/DELETE) don't collide (different methods).
  .use(nutritionEntriesListHandler)
  .use(nutritionEntriesCreateHandler)
  .use(nutritionEntriesUpdateHandler)
  .use(nutritionEntriesDeleteHandler)
  .use(nutritionTargetsGetHandler)
  .use(nutritionTargetsSetHandler)
  .use(nutritionWaterGetHandler)
  .use(nutritionWaterPatchHandler)
  .use(nutritionBarcodeResolveHandler)
  // AI Tier B (M9.5) — both gate on `ai_access` inside the handler.
  .use(nutritionAiEstimateHandler)
  .use(nutritionAiEstimateTextHandler)
  // Recipes AI (recipe-photo extraction + AI ingredient resolution) — same
  // `ai_access` gate, reuses the M9.5 Bedrock harness.
  .use(nutritionAiExtractRecipeHandler)
  .use(nutritionAiResolveIngredientHandler)
  .use(foodsListHandler)
  .use(foodsCreateHandler)
  // recipes — GET /recipes (list) before GET /recipes/:id; POST /recipes/import
  // (literal) before the /recipes/:id handlers.
  .use(recipesListHandler)
  .use(recipesCreateHandler)
  .use(recipesImportHandler)
  .use(recipesGetHandler)
  .use(recipesUpdateHandler)
  .use(recipesDeleteHandler)
  // meals — GET /meals (list) before GET /meals/:id.
  .use(mealsListHandler)
  .use(mealsCreateHandler)
  .use(mealsGetHandler)
  .use(mealsUpdateHandler)
  .use(mealsDeleteHandler);
