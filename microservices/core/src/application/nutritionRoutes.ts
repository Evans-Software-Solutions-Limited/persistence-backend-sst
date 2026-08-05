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
import { nutritionAiEstimateRecipeHandler } from "./nutrition/ai/estimateRecipe/nutritionAiEstimateRecipeHandler";
// Mealprint (spec-26) Phase 0. Joins this ALREADY-mounted sub-app rather than
// adding a `.use()` to the root chain in api.ts — that chain is at TS's
// instantiation ceiling and a new root mount trips TS2589 in packages/web's Eden
// client with no web file touched (see the sleep-quicklog note below).
import { nutritionPreferencesGetHandler } from "./nutrition/mealprint/preferences/get/nutritionPreferencesGetHandler";
import { nutritionPreferencesSetHandler } from "./nutrition/mealprint/preferences/set/nutritionPreferencesSetHandler";
import { nutritionAiMealSuggestHandler } from "./nutrition/mealprint/ai/suggest/nutritionAiMealSuggestHandler";
import { nutritionAiPlanGenerateHandler } from "./nutrition/mealprint/ai/planGenerate/nutritionAiPlanGenerateHandler";
import { nutritionAiPlanMealSwapHandler } from "./nutrition/mealprint/ai/planSwap/nutritionAiPlanMealSwapHandler";
import { nutritionPlansCreateHandler } from "./nutrition/mealprint/plans/create/nutritionPlansCreateHandler";
import { nutritionPlansReadHandlers } from "./nutrition/mealprint/plans/read/nutritionPlansReadHandlers";
import { nutritionPlanMealLogHandler } from "./nutrition/mealprint/plans/log/nutritionPlanMealLogHandler";
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
// specs/20-sleep-quicklog (PR-A backend) — manual sleep quick-log. Bolted
// onto this ALREADY-mounted sub-app (rather than a new `.use()` on the root
// `app` chain in api.ts) purely to stay under TS's type-depth ceiling: the
// root chain is already at the TS2589 limit (see trainersOnBehalfRoutes'
// comment above its api.ts mount for the same constraint), so any new leaf
// route MUST join an existing grouped sub-app, not add a new root `.use()`.
// No domain relationship to nutrition — health/day-tracking is simply where
// there happened to be headroom.
import { healthRoutes } from "./healthRoutes";

export const nutritionRoutes = new Elysia()
  .use(healthRoutes)
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
  // ⚠ PRIVACY POLICY DEPENDENCY — adding an AI route below obliges a policy
  // update. Both copies of the privacy policy enumerate the AI features by name
  // (`packages/web/src/pages/Privacy.tsx` § "AI features and what they do with
  // your data" and `packages/mobile/.../PrivacyPolicyPresenter.tsx` § 5), and
  // their tests assert a HARDCODED list — so a newly mounted AI endpoint passes
  // CI while leaving the policy incomplete, which is a UK GDPR Art 13(1)(c) gap.
  // This has already happened once: `nutritionAiMealSuggestHandler` shipped
  // undisclosed. If you add one here, add it there.
  //
  // AI Tier B (M9.5) — both gate on `ai_access` inside the handler.
  .use(nutritionAiEstimateHandler)
  .use(nutritionAiEstimateTextHandler)
  // Recipes AI (recipe-photo extraction + AI ingredient resolution) — same
  // `ai_access` gate, reuses the M9.5 Bedrock harness.
  .use(nutritionAiExtractRecipeHandler)
  .use(nutritionAiResolveIngredientHandler)
  .use(nutritionAiEstimateRecipeHandler)
  // Mealprint (spec-26) — preferences are NOT entitlement-gated (they are the
  // user's own data; the paywall sits on generation). See the handlers.
  .use(nutritionPreferencesGetHandler)
  .use(nutritionPreferencesSetHandler)
  // …but the suggestion endpoint IS gated: `meal_ai` (402) → daily ceiling
  // (429) → pipeline, inside the handler.
  .use(nutritionAiMealSuggestHandler)
  // Mealprint plan GENERATION — both `meal_ai`-gated (402 → 429 → pipeline),
  // both stateless drafts. ⚠ PRIVACY POLICY: these are new AI features; both
  // policy copies (web `Privacy.tsx` § AI features, mobile
  // `PrivacyPolicyPresenter.tsx` § 5) enumerate Mealprint's AI use, and their
  // tests assert a hardcoded list. Kept in step in this same PR.
  .use(nutritionAiPlanGenerateHandler)
  .use(nutritionAiPlanMealSwapHandler)
  // Mealprint plans (spec-26 Phase 2). Accept/read/patch/delete/log are UNGATED for
  // the same reason preferences are: the paywall is on generation, and a lapsed
  // subscriber must keep access to plans they made while paying.
  //
  // `nutritionPlansReadHandlers` declares `/plans/active` before `/plans/:id` as
  // a readability convention — NOT a requirement: Elysia's radix router prefers a
  // static segment over a dynamic one whatever the declaration order, verified by
  // swapping them (see that file's docstring). Mounting the create handler either
  // side is safe (POST vs GET). Keep the read handlers together regardless.
  .use(nutritionPlansCreateHandler)
  .use(nutritionPlansReadHandlers)
  .use(nutritionPlanMealLogHandler)
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
