# 13 — Nutrition Tracking: Tasks

> **Spec rewritten from scratch on 2026-05-27.** Prior tasks (PR #79 spec) preserved in git history.

---

## Phase 13.1 — Database migrations (1 PR)

- [ ] **T-13.1.1** Migration: `foods`, `nutrition_entries` (incl. `logged_by_user_id` + AI flags), `nutrition_targets` (incl. `set_by_user_id`), `water_log`, `recipes`, `recipe_ingredients`, `meals`, `meal_items` per `design.md § Database schema`.
- [ ] **T-13.1.2** Migration: `ai_usage_log` table (lands with M9 even though Tier B uses it — establishes contract per cross-cuts § 4.2).
- [ ] **T-13.1.3** Migrations idempotent + forward/back safe.

## Phase 13.2 — M9 Tier A backend endpoints (1 PR)

- [ ] **T-13.2.1** `/nutrition/today`, `/nutrition/entries` CRUD, `/nutrition/targets` GET/PUT. Implements STORY-001 + 003 + 004 ACs.
- [ ] **T-13.2.2** `/nutrition/water/today` GET + PATCH. Implements STORY-009.
- [ ] **T-13.2.3** `/nutrition/barcode/resolve` — Open Food Facts integration. Implements STORY-002.
- [ ] **T-13.2.4** `/foods` GET (search) + POST (user creates custom).
- [ ] **T-13.2.5** Streak integration: end-of-day cron evaluates `nutrition_streak` per `design.md § Streak engine integration`. Implements STORY-010.

## Phase 13.3 — Recipes + Meals backend (1 PR)

- [ ] **T-13.3.1** `/recipes` CRUD. Implements STORY-005 + 006.
- [ ] **T-13.3.2** `/recipes/import` URL scraper (Schema.org Recipe microformat). Implements STORY-008.
- [ ] **T-13.3.3** `/meals` CRUD. Implements STORY-007.
- [ ] **T-13.3.4** Server-side macro materialisation on recipe save (sums ingredients).

## Phase 13.4 — M9.5 Tier B backend endpoints (1 PR)

- [ ] **T-13.4.1** `/nutrition/ai/recognize-photo` — multipart photo → LLM/vision recognition. AI gating + `ai_usage_log` per cross-cuts § 4. Implements STORY-011.
- [ ] **T-13.4.2** `/nutrition/ai/estimate-text` — text → macro estimate. Implements STORY-012.
- [ ] **T-13.4.3** `/recipes/ai/extract-photo` — OCR + LLM extract. Implements STORY-013.
- [ ] **T-13.4.4** Each handler asserts `aiAccess` entitlement first; 402 + `ENTITLEMENT_DENIED` payload per cross-cuts § 4.1.

## Phase 13.5 — Frontend domain + adapters (1 PR)

- [ ] **T-13.5.1** Domain models: `Food`, `NutritionEntry`, `NutritionTarget`, `WaterLog`, `Recipe`, `Meal`, `MealSlot` enum.
- [ ] **T-13.5.2** API port + adapter extensions.
- [ ] **T-13.5.3** SQLite cache repositories.
- [ ] **T-13.5.4** Sync queue handlers (entries, targets, water, recipes, meals).

## Phase 13.6 — Frontend hooks (1 PR)

- [ ] **T-13.6.1** `useGetFuelToday`, `useGetNutritionEntries`, `useGetNutritionTarget`, `useGetWaterToday`, `useGetRecipes`, `useGetMeals`, `useGetFood`, `useSearchFoods`.
- [ ] **T-13.6.2** Mutations: `useLogEntry`, `useEditEntry`, `useDeleteEntry`, `useSetTargets`, `useIncrementWater`, `useDecrementWater`, `useResolveBarcode`, `useCreateRecipe`, `useImportRecipeUrl`, `useCreateMeal`.
- [ ] **T-13.6.3** Tier B hooks: `useRecognizePhoto`, `useEstimateText`, `useExtractRecipePhoto` (all check `useEntitlement('aiAccess')`).
- [ ] **T-13.6.4** Tests.

## Phase 13.7 — FuelPresenter + sub-presenters (1 PR)

- [ ] **T-13.7.1** `<FuelPresenter>` per `nutrition.jsx`. Implements STORY-001 ACs.
- [ ] **T-13.7.2** `<MacroHeroPresenter>` (Ring + macro lines + consumed/target stat). Implements STORY-001 AC 1.3 + 1.4.
- [ ] **T-13.7.3** `<QuickAddRowPresenter>` (3-button strip; Snap shows lock when `!aiEntitled`).
- [ ] **T-13.7.4** `<MealLogPresenter>` (4 sections per `nutrition.jsx MealLog`).
- [ ] **T-13.7.5** `<WaterTrackerPresenter>` per `nutrition.jsx WaterTracker` with haptics.
- [ ] **T-13.7.6** `<FuelContainer>` wiring all hooks. Replaces `<ComingSoon/>` at `(app)/(tabs)/fuel.tsx`.

## Phase 13.8 — Sheets (1 PR each)

- [ ] **T-13.8.1** `<ScanBarcodeSheet>` per STORY-002.
- [ ] **T-13.8.2** `<QuickAddSheet>` per STORY-003.
- [ ] **T-13.8.3** `<SnapAISheet>` (Tier B) per STORY-011.

## Phase 13.9 — Fuel Targets screen (1 PR)

- [ ] **T-13.9.1** `<FuelTargetsPresenter>` + container per STORY-004. Trainer-attribution banner per cross-cuts § 1.5.

## Phase 13.10 — Recipes library + flows (1 PR)

- [ ] **T-13.10.1** `<RecipesLibraryPresenter>` per STORY-005.
- [ ] **T-13.10.2** `<CreateRecipeManualPresenter>` per STORY-006.
- [ ] **T-13.10.3** `<ImportRecipeURLPresenter>` per STORY-008.
- [ ] **T-13.10.4** `<CreateMealFromLoggedSheetPresenter>` per STORY-007.

## Phase 13.11 — Tier B AI flows (1 PR)

- [ ] **T-13.11.1** `<SnapAISheet>` integration with `/nutrition/ai/recognize-photo`. Recognising animation. Editable confidence cards.
- [ ] **T-13.11.2** "Or describe it…" CTA in Quick Add → `<EstimateTextSheet>` → `/nutrition/ai/estimate-text`.
- [ ] **T-13.11.3** `<SnapRecipePhotoSheet>` → `/recipes/ai/extract-photo`.
- [ ] **T-13.11.4** All entry points show upgrade prompt when `!aiEntitled`.

## Phase 13.12 — Cleanup + verification

- [ ] **T-13.12.1** Run `01-design-system § Codemod` against new files.
- [ ] **T-13.12.2** `bun run typecheck`, `bun run lint`, `bun run build`, `bun run test:unit` — all green.
- [ ] **T-13.12.3** 90% coverage on new application + handler code.
- [ ] **T-13.12.4** Manual e2e:
  - Athlete user opens Fuel → MacroHero ring shows current intake → log breakfast via barcode → ring updates → log lunch via Quick Add → see meal grouping.
  - Set targets → return to Fuel → ring reflects new target.
  - Increment water → tap +/- → haptic fires.
  - Create recipe manually → save → appears in Recipes library.
  - Tier B with aiAccess: snap a meal photo → recognised items → add. Without aiAccess: see upgrade prompt.
  - Offline: log entry → kcal counter updates → reconnect → assert sync flush.
  - Day in target → next day, streak advances.

---

## Acceptance gate (nutrition tracking phase complete)

- [ ] All 12 phases shipped as PRs.
- [ ] M9 Tier A fully functional offline-first.
- [ ] M9.5 Tier B gated on `aiAccess`; ai_usage_log writes verified.
- [ ] Streak integration with `06-progress-goals` engine verified.
- [ ] Trainer-set nutrition target attribution badge visible (cross-cut with `10-trainer-features` verified).
- [ ] Fuel tab in `14-navigation` replaces `<ComingSoon/>` placeholder.

---

_End of `13-nutrition-tracking/tasks.md` · 2026-05-27 (rewritten from scratch)_
