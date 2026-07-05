# 13 — Nutrition Tracking: Tasks

> **Spec rewritten from scratch on 2026-05-27.** Prior tasks (PR #79 spec) preserved in git history.

---

> **M9 scoping (2026-06-21).** Phases 13.1, 13.2, 13.3 are **M9 Tier A** (backend) — in scope for the `feat/m9-backend-nutrition` branch. Phase 13.4 (Tier B AI endpoints) is **deferred to M9.5**. The OFF curated seed + delta cron (BACKEND_BRIEF § 9) lands as an additional M9 backend task — see 13.3.5/13.3.6 below.

## Phase 13.1 — Database migrations (1 PR) — M9 — **SHIPPED (#124)**

- [x] **T-13.1.1** Migration: `foods`, `nutrition_entries` (incl. `logged_by_user_id` + AI flags), `nutrition_targets` (incl. `set_by_user_id`), `water_log`, `recipes`, `recipe_ingredients`, `meals`, `meal_items` per `design.md § Database schema`.
- [x] **T-13.1.2** Migration: `ai_usage_log` table (lands with M9 even though Tier B uses it — establishes contract per cross-cuts § 4.2).
- [x] **T-13.1.3** Migrations idempotent + forward/back safe.
- [x] **T-13.1.4** `ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'daily_nutrition_target_hit'` — own migration statement (not in a using-transaction), sequenced before the streak cron emit. Mirror in `notificationTypeEnum` (schema.ts) + the `NotificationType` union.

## Phase 13.2 — M9 Tier A backend endpoints (1 PR) — M9 — **SHIPPED (#124)**

- [x] **T-13.2.1** `/nutrition/today`, `/nutrition/entries` CRUD, `/nutrition/targets` GET/PUT. Implements STORY-001 + 003 + 004 ACs.
- [x] **T-13.2.2** `/nutrition/water/today` GET + PATCH. Implements STORY-009.
- [x] **T-13.2.3** `/nutrition/barcode/resolve` — Open Food Facts integration. Implements STORY-002.
- [x] **T-13.2.4** `/foods` GET (search) + POST (user creates custom).
- [x] **T-13.2.5** Streak integration: end-of-day cron evaluates `nutrition_streak` per `design.md § Streak engine integration`. Implements STORY-010.

## Phase 13.3 — Recipes + Meals backend (1 PR) — M9 — **SHIPPED (#124)**

- [x] **T-13.3.1** `/recipes` CRUD. Implements STORY-005 + 006.
- [x] **T-13.3.2** `/recipes/import` URL scraper (deterministic Schema.org / `ld+json` only; SSRF-hardened; `422 no_recipe_microdata` on a scrape miss). Implements STORY-008.
- [x] **T-13.3.3** `/meals` CRUD. Implements STORY-007.
- [x] **T-13.3.4** Server-side macro materialisation on recipe + meal save (sums ingredients / items).
- [x] **T-13.3.5** OFF curated seed ETL script (`seedOpenFoodFacts.ts`) — Parquet-sourced curated subset → `foods` (`source='openfoodfacts'`), idempotent upsert on `barcode`. Own PR. BACKEND_BRIEF § 9a.
- [x] **T-13.3.6** OFF delta-refresh cron (`offDeltaCron.ts` + `sst.aws.Cron`) — applies OFF daily deltas; logs `[off-delta:summary]`. BACKEND_BRIEF § 9b.

## Phase 13.4 — M9.5 Tier B backend endpoints (1 PR) — **SHIPPED 2026-07-05 (#153/#155; ceilings #156)**

- [x] **T-13.4.1** `ai_access` real entitlement check: add `'ai_access'` to `EntitlementFeature`, implement tier-flag check in `assertEntitlement` (closes C6). Wire payload = the SHIPPED M10.5 shape (`feature: 'ai_access'` etc. — see cross-cuts § 4.1 Revised 2026-07-03).
- [x] **T-13.4.2** Bedrock adapter `application/nutrition/services/aiEstimation.ts` — `@anthropic-ai/bedrock-sdk`, forced tool use, injectable client, timeout/retry/refusal mapping (design.md § Revised 2026-07-03).
- [x] **T-13.4.3** `POST /nutrition/ai/estimate` — base64 JSON photo → `AiEstimate`. Gate + size/magic-byte checks + `ai_usage_log` in `finally`. Implements STORY-011.
- [x] **T-13.4.4** `POST /nutrition/ai/estimate-text` — text → `AiEstimate` on the text model. Implements STORY-012.
- [x] **T-13.4.5** Infra: `bedrock:InvokeModel` IAM permission on the two inference-profile ARNs in `infra/api.ts` + `AI_PHOTO_MODEL_ID`/`AI_TEXT_MODEL_ID` env. No secret.
- [x] **T-13.4.6** Daily ceilings DECIDED + shipped (#156): photo 12/day, text 30/day → `429 ai_daily_limit`; usage log counts actual inferences only (cross-cuts § 4.3 Revised 2026-07-05).
- [ ] ~~T-13.4.x `/recipes/ai/extract-photo`~~ — STORY-013 stays **deferred** (post-M9.5).

## Phase 13.5 — Frontend domain + adapters (1 PR) — **SHIPPED (#135)**

- [x] **T-13.5.1** Domain models: `Food`, `NutritionEntry`, `NutritionTarget`, `WaterLog`, `Recipe`, `Meal`, `MealSlot` enum.
- [x] **T-13.5.2** API port + adapter extensions.
- [x] **T-13.5.3** SQLite cache repositories.
- [x] **T-13.5.4** Sync queue handlers (entries, targets, water, recipes, meals).

## Phase 13.6 — Frontend hooks (1 PR) — **SHIPPED (#135)**

- [x] **T-13.6.1** `useGetFuelToday`, `useGetNutritionEntries`, `useGetNutritionTarget`, `useGetWaterToday`, `useGetRecipes`, `useGetMeals`, `useGetFood`, `useSearchFoods`.
- [x] **T-13.6.2** Mutations: `useLogEntry`, `useEditEntry`, `useDeleteEntry`, `useSetTargets`, `useIncrementWater`, `useDecrementWater`, `useResolveBarcode`, `useCreateRecipe`, `useImportRecipeUrl`, `useCreateMeal`.
- [x] **T-13.6.3** Tier B hooks — shipped in M9.5 as adapter methods + `useNutritionAiGate('ai_access')` (see 13.11); `useExtractRecipePhoto` deferred with STORY-013.
- [x] **T-13.6.4** Tests.

## Phase 13.7 — FuelPresenter + sub-presenters (1 PR) — **SHIPPED (#135)**

- [x] **T-13.7.1** `<FuelPresenter>` per `nutrition.jsx`. Implements STORY-001 ACs.
- [x] **T-13.7.2** `<MacroHeroPresenter>` (Ring + macro lines + consumed/target stat). Implements STORY-001 AC 1.3 + 1.4.
- [x] **T-13.7.3** `<QuickAddRowPresenter>` (3-button strip; Snap shows lock when `!aiEntitled`).
- [x] **T-13.7.4** `<MealLogPresenter>` (4 sections per `nutrition.jsx MealLog`).
- [x] **T-13.7.5** `<WaterTrackerPresenter>` per `nutrition.jsx WaterTracker` with haptics.
- [x] **T-13.7.6** `<FuelContainer>` wiring all hooks. Replaces `<ComingSoon/>` at `(app)/(tabs)/fuel.tsx`.

## Phase 13.8 — Sheets (1 PR each) — **SHIPPED (#135)**

- [x] **T-13.8.1** `<ScanBarcodeSheet>` per STORY-002.
- [x] **T-13.8.2** `<QuickAddSheet>` per STORY-003.
- [x] **T-13.8.3** `<SnapAISheet>` (Tier B) per STORY-011.

## Phase 13.9 — Fuel Targets screen (1 PR) — **SHIPPED (#135/#144/#147)**

- [x] **T-13.9.1** `<FuelTargetsPresenter>` + container per STORY-004. Trainer-attribution banner per cross-cuts § 1.5.

## Phase 13.10 — Recipes library + flows (1 PR) — **SHIPPED (#135)**

- [x] **T-13.10.1** `<RecipesLibraryPresenter>` per STORY-005.
- [x] **T-13.10.2** `<CreateRecipeManualPresenter>` per STORY-006.
- [x] **T-13.10.3** `<ImportRecipeURLPresenter>` per STORY-008.
- [x] **T-13.10.4** `<CreateMealFromLoggedSheetPresenter>` per STORY-007.

## Phase 13.11 — Tier B AI flows (1 PR) — **SHIPPED 2026-07-05 (#154; 429 copy #156)**

- [x] **T-13.11.1** `<SnapAISheet>` per `fuel-sheets.jsx SnapSheet`: capture (camera + library pick) → `expo-image-manipulator` downscale/compress → `POST /nutrition/ai/estimate` → recognizing animation → editable draft card (per-item confidence %, <0.7 default-unticked) → confirm → `POST /nutrition/entries` per kept item.
- [x] **T-13.11.2** "Or describe it…" CTA in Quick Add → text input → `/nutrition/ai/estimate-text` → same draft-card confirm flow.
- [x] **T-13.11.3** Offline: Snap affordance disabled ("Snap needs a connection — try Quick Add instead"); AI calls never queue. Failure: 422/503 → "Couldn't read this photo" + retry.
- [x] **T-13.11.4** All entry points show upgrade prompt when `!aiEntitled` (gate hook keys off `tier.aiAccess`). Add `'ai_access'` to the mobile `EntitlementFeature` union (`domain/models/entitlement.ts`) — the strict 402 parser casts `feature` to it. Compile-breaks to fix at the same time: `FEATURE_DISPLAY_NAMES` `Record<EntitlementFeature, string>` maps in `useFeatureGate.ts` and `SyncBlockedPresenter.tsx` need an `ai_access` entry; refresh the stale "stubs" doc comments in both unions.
- [x] **T-13.11.5** Widen `expo-camera`/`expo-image-picker` permission strings for meal photos; verify merged `NSCameraUsageDescription` at prebuild; new EAS dev build.
- [ ] ~~T-13.11.x `<SnapRecipePhotoSheet>`~~ — STORY-013 stays **deferred**.

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
- [x] M9.5 Tier B gated on `ai_access`; ai_usage_log writes verified (actual inferences only per cross-cuts § 4.3 Revised 2026-07-05).
- [ ] Streak integration with `06-progress-goals` engine verified.
- [ ] Trainer-set nutrition target attribution badge visible (cross-cut with `10-trainer-features` verified).
- [ ] Fuel tab in `14-navigation` replaces `<ComingSoon/>` placeholder.

---

_End of `13-nutrition-tracking/tasks.md` · 2026-05-27 (rewritten from scratch)_
