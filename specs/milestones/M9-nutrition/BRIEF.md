# M9 — Nutrition (Fuel) · Tier A

> Authored 2026-06-21. Scopes **Tier A only** (manual log + barcode + macros + water + recipes/meals + targets + nutrition streak). **M9.5 Tier B (AI photo / LLM text / AI recipe extraction) is deferred to a follow-on brief** — see § Deferred to M9.5.

## Why this milestone

The Fuel tab is a `<ComingSoon/>` placeholder today ([`packages/mobile/app/(app)/(tabs)/fuel.tsx`](../../../packages/mobile/app/(app)/(tabs)/fuel.tsx)). The IA slot was reserved by `14-navigation` precisely so M9 could drop the real surface in without a nav reshuffle. Nutrition is **greenfield** — there is no legacy V1 nutrition screen to port (parent spec `requirements.md` § Authoritative references, item 7). The authoritative UI reference is the May-2026 design package (`~/Downloads/handoff/design-source/screens/{nutrition,fuel-targets,fuel-sheets,recipes}.jsx`), which **is present on disk** (the original handoff note that flagged it missing is stale — only `tokens.tamagui.ts` sits one directory up, at `~/Downloads/handoff/tokens.tamagui.ts`).

Three things are missing and this milestone delivers them:

1. **Backend** — `microservices/core/src/application/` has zero nutrition files. M9 adds the full Tier-A endpoint surface (entries, targets, water, barcode, foods, recipes, meals) plus the migration block (9 new tables + 1 enum value) and the nutrition-streak hook into the existing M4 streak cron.
2. **Mobile** — no Fuel domain, no cache tables, no sync-queue entity types, no Fuel screen. M9 builds the offline-first stack (SQLite cache + queued/optimistic writes) and the screen tree per the prototype, replacing `<ComingSoon/>`.
3. **Cross-cuts** — `daily_nutrition_target_hit` is not yet in the `notification_type` DB enum; `nutrition_targets.set_by_user_id` is the column `10-trainer-features` will write through (M8). M9 ships both so downstream specs unblock.

## Parent spec

[`../../13-nutrition-tracking/`](../../13-nutrition-tracking/) — requirements (STORY-001 → STORY-010 in scope; STORY-011 → STORY-013 deferred), design (everything except the `nutrition/ai/*` + `recipes/ai/*` endpoints and the Tier-B sheets), tasks (Phases 13.1, 13.2, 13.3, 13.5, 13.6, 13.7, 13.8.1–.2, 13.9, 13.10, 13.12 — **not** 13.4, 13.8.3, 13.11).

Cross-cutting authority: [`../../_shared/cross-cuts.md`](../../_shared/cross-cuts.md) — § 1.1/1.5 (`logged_by_user_id` + `set_by_user_id`), § 3.1 (`nutrition_streak`), § 4 (AI entitlement — Tier B only), § 5 (notification taxonomy).

Architecture + offline rules: [`../../../CLAUDE.md`](../../../CLAUDE.md), [`../../_agent.md`](../../_agent.md), [`../../../docs/mobile-v2-offline-first-plan.md`](../../../docs/mobile-v2-offline-first-plan.md).

## Scope summary

### Backend (one branch, may stack 2 PRs — migrations+core, then recipes/meals)

- **Migration block** — `foods`, `recipes`, `recipe_ingredients`, `meals`, `meal_items`, `nutrition_entries`, `nutrition_targets`, `water_log`, `ai_usage_log`, in FK-dependency order. `nutrition_entries.logged_by_user_id` + `ai_estimated` + `ai_confidence` columns ship now but stay unused until M8/M9.5. `nutrition_targets.set_by_user_id` ships now (M8 writes it). Plus the coordinated `ALTER TYPE notification_type ADD VALUE 'daily_nutrition_target_hit'`.
- **Endpoints (Tier A)** — `GET /nutrition/today`, `GET/POST/PUT/DELETE /nutrition/entries`, `GET/PUT /nutrition/targets`, `GET/PATCH /nutrition/water/today`, `POST /nutrition/barcode/resolve` (Open Food Facts), `GET/POST /foods`, `GET/POST/PUT/DELETE /recipes`, `POST /recipes/import` (SSRF-hardened Schema.org scrape), `GET/POST/PUT/DELETE /meals`.
- **Streak** — fold `nutrition_streak` (daily, kcal within target ±10%) into the existing 02:00 UTC streak cron ([`infra/api.ts:89`](../../../infra/api.ts)); emit `daily_nutrition_target_hit` (default opt-in **off**).
- **OFF curated seed (Brad confirmed in-scope 2026-06-21)** — seed `foods` from the OFF Parquet dump (curated subset: complete-macro + target-locale barcoded products) + a daily delta-refresh cron, so offline barcode works at launch and the live OFF rate limit is a non-issue. Own PR; see BACKEND_BRIEF § 9 + DATA_SOURCING.md § 5.
- **NOT in M9:** any `nutrition/ai/*` or `recipes/ai/*` endpoint; LLM recipe-extraction fallback; trainer on-behalf nutrition entry logging (Tier C).

### Frontend (one branch, expect 3 stacked PRs — foundation, Fuel screen + sheets, recipes/targets flows)

- **Foundation** — domain models, `api.port.ts` method additions, SQLite cache tables, sync-queue entity types, hooks (Tier A only).
- **Fuel screen** — `<FuelContainer>`/`<FuelPresenter>` + `<MacroHero>` (single `<Ring>`), `<QuickAddRow>`, `<MealLog>`, `<WaterTracker>`. Replaces `<ComingSoon/>`.
- **Sheets** — `<ScanBarcodeSheet>`, `<QuickAddSheet>` (no Tier-B "describe it" CTA). Snap button renders **locked** (`!aiEntitled`).
- **Fuel Targets** — `<FuelTargetsContainer>`/`<FuelTargetsPresenter>` (see § Conflict C2 for scope decision).
- **Recipes** — `<RecipesLibrary>`, `<CreateRecipeManual>`, `<ImportRecipeURL>` (deterministic scrape only), `<CreateMealFromLogged>`.
- **New native deps** — `@shopify/flash-list`, `expo-image`, `expo-camera`, `expo-haptics` (see § New dependencies + EAS impact).
- **NOT in M9:** `<SnapAISheet>`, `<EstimateTextSheet>`, `<SnapRecipePhotoSheet>`, the auto-estimate-macros AI toggle on Create Recipe.

## Spec ↔ reality conflicts — resolutions PROPOSED, pending Brad sign-off

Per [`_agent.md`](../../_agent.md) rule 6 (spec wins) and the `feedback_prototype_first_source_of_truth` memory (prototype wins over spec when they disagree; build to prototype + fix the spec). Each agent's **first commit** updates the parent spec to the agreed resolution before any implementation.

| # | Conflict | Proposed resolution |
| - | -------- | ------------------- |
| **C1** | **New native deps.** Barcode scan (STORY-002, *Tier A core*) needs a camera lib; the perf budget needs FlashList + expo-image; the water tracker needs haptics. None are installed (`packages/mobile/package.json` has only `expo-image-manipulator`/`expo-image-picker`, no `expo-camera`, `vision-camera`, `flash-list`, `expo-image`, or `expo-haptics`). | Add `expo-camera` (built-in barcode scanning, Expo-managed, simplest), `@shopify/flash-list`, `expo-image`, `expo-haptics`. **This forces a new EAS dev build** — Expo Go cannot run native camera. See § New dependencies + EAS impact. `react-native-vision-camera` held as the perf fallback per design.md § Risks if expo-camera frame cost is too high on Android. **Needs Brad's OK on the dep set + dev-build cut.** |
| **C2** | **Fuel Targets scope.** Prototype `fuel-targets.jsx` is a full **TDEE calculator** (Age/Sex/Height/Weight profile strip + 5 activity-multiplier chips + a cut↔bulk goal slider that auto-computes kcal). Spec STORY-004 describes a *manual* editor and explicitly lists "Macro target auto-recalc from goals … No auto-tuning in v1" as **out of scope** (`requirements.md` § Out of scope). Direct contradiction. | **Prototype wins** (prototype-first memory): build the TDEE calculator; FE agent's first commit rewrites STORY-004 ACs + deletes the out-of-scope "no auto-tuning" line. TDEE/BMR math is a pure domain service (Mifflin-St Jeor), fully unit-testable, no extra backend (the computed kcal/macros still save via `PUT /nutrition/targets`). **This is the single biggest scope expansion vs the written spec — Brad should bless it explicitly.** Fallback if Brad wants a lean M9: ship the simple numeric editor + presets, defer the calculator to a polish pass. |
| **C3** | **Import-URL tier.** Prototype shows an "AI" pill on Import-from-URL and an extraction animation; spec STORY-008 is a deterministic Schema.org/`ld+json` scrape (Tier A). design.md § Risks adds an *LLM fallback* for non-Schema.org sites. | M9 ships **deterministic scrape only** (Tier A). If the page has no `Recipe` microdata → return a clear "couldn't read this page" state; the LLM fallback + the "AI" pill defer to M9.5. FE drops the AI pill on the Tier-A import entry; BE `POST /recipes/import` returns `422 no_recipe_microdata` on a scrape miss. |
| **C4** | **Auto-estimate-macros toggle** on Create-Recipe-Manual is AI (Tier B) in the prototype; spec STORY-006 computes per-serving macros deterministically by summing ingredients. | M9 ships the deterministic ingredient-sum (server materialises `total_*` on save). The AI "auto-estimate from name" toggle renders **disabled/locked** (Tier B), consistent with the Snap-locked treatment. |
| **C5** | **QuickAddRow button count.** Prototype: 4 buttons (Scan / Snap / Search / Recipes). Spec decision #4 / STORY-001 AC 1.5: 3 (Scan / Snap / Recipes). | Build **4 per prototype**; "Search" opens `<QuickAddSheet>` in search mode (it already exists). FE first commit updates AC 1.5. |
| **C6** | **Entitlement hook + feature key.** Spec/cross-cuts reference `useEntitlement('aiAccess')` and `assertEntitlement(userId, 'aiAccess')`. Real mobile hook is `useFeatureGate` ([`packages/mobile/src/ui/hooks/useFeatureGate.ts`](../../../packages/mobile/src/ui/hooks/useFeatureGate.ts)); real backend `EntitlementFeature` union ([`microservices/core/src/application/entitlement/assertEntitlement.ts`](../../../microservices/core/src/application/entitlement/assertEntitlement.ts)) has **no `aiAccess`** member (`create_workout \| ai_workout \| gym_buddy \| unlimited_exercise_library \| trainer_clients`). | **Tier-B-only, so it does not block M9.** For M9, the Snap/AI affordances render locked via `useFeatureGate` with a placeholder reason; the real `aiAccess` feature key is added in the M9.5 brief, which reconciles cross-cuts § 4 + the `EntitlementFeature` union + adds the mobile alias. M9 must NOT invent a half-wired `aiAccess` path. |

## New dependencies + EAS impact (carry into FRONTEND_BRIEF)

`expo-camera` is a native module — **Expo Go cannot load it**. Adding it (and the others) means:

1. The dev workflow moves to an **EAS dev client build** for anyone testing barcode scanning on device. The SMOKE_TEST barcode steps require a dev build, not Expo Go.
2. iOS needs `NSCameraUsageDescription`; Android needs `CAMERA` permission. Both go in `app.json` (`expo-camera` config plugin handles the wiring). **No secret values** — these are public Info.plist strings.
3. `@shopify/flash-list` + `expo-image` + `expo-haptics` are also native but already covered by the new dev build — no incremental build cost beyond the camera cut.

Brad's one-time action (outside agent scope): cut a new EAS dev build (`eas build --profile development`) once the deps land so the barcode SMOKE_TEST runs on device. Surface in PR review if the build hasn't been cut — do NOT attempt EAS auth from the agent.

## Success criteria (review gate)

Done when **all** pass against `bun run dev` + an EAS dev build on device:

1. Fuel tab renders the real screen (no `<ComingSoon/>`); MacroHero shows a single gold `<Ring>` with REMAINING kcal centred + P/C/F lines.
2. Log breakfast via barcode scan → entry appears in the Breakfast section → ring + consumed/target recalc.
3. Log lunch via Quick Add (search → select → serving → meal slot) → appears in Lunch.
4. Edit + delete an entry → macros recalc.
5. Water tracker: tap +/- → count changes with haptic → persists; resets at user-local midnight.
6. Open Fuel Targets → set kcal/macros/water (+ TDEE calc per C2) → return → ring reflects new target.
7. Create a recipe manually (ingredients + servings) → server materialises per-serving macros → appears in Recipes library.
8. Import a recipe from a Schema.org URL → form pre-fills → save. A no-microdata URL → graceful "couldn't read" state.
9. Create a meal from today's logged foods → appears in Meals tab.
10. **Offline:** airplane mode → log an entry → ring updates optimistically → reconnect → `sync_queue` flushes → server reflects it.
11. **Offline barcode:** cached food → resolves from local `foods`; uncached → "Food not in cache — connect to fetch" (no crash). Common seeded products resolve with no live OFF call (OFF curated seed ran).
12. Snap button + auto-estimate toggle render **locked** (Tier B) — tapping shows the upgrade placeholder, no AI call fires.
13. Day exactly in-target → next 02:00 UTC cron → `nutrition_streak` advances; off-target → no advance.
14. SSRF: `POST /recipes/import` with `http://169.254.169.254/...` (and each private-CIDR / redirect-to-private case) → 400, no fetch.
15. Per-PR quality gates (prettier / typecheck / lint / build / test, ≥90% coverage on changed files).

## Agent briefs

Two parallel tracks, each off fresh `origin/main`:

- **Backend:** [`BACKEND_BRIEF.md`](./BACKEND_BRIEF.md) — branch `feat/m9-backend-nutrition`
- **Frontend:** [`FRONTEND_BRIEF.md`](./FRONTEND_BRIEF.md) — branch `feat/m9-mobile-nutrition`
- **Smoke test:** [`SMOKE_TEST.md`](./SMOKE_TEST.md)
- **Data sourcing (read before barcode work):** [`DATA_SOURCING.md`](./DATA_SOURCING.md) — Open Food Facts (free, no key, **15 req/min/IP** → cache-first is mandatory, not optional), on-device barcode decode (expo-camera, free/offline), and the AI-recognition direction for M9.5.

Frontend depends on backend endpoints. Preferred: **backend merges first**, frontend rebases. Otherwise frontend develops against `InMemoryApiAdapter` fixtures matching the § Cross-cutting wire shapes; the smoke test gates on backend being merged.

## Explicit non-goals for M9

- **No AI.** No `nutrition/ai/*`, no `recipes/ai/*`, no LLM recipe fallback, no auto-estimate-from-name. All defer to the M9.5 brief.
- **No trainer-on-behalf nutrition entry logging** (Tier C). `nutrition_entries.logged_by_user_id` ships nullable + unused; `PUT /trainers/me/clients/:clientId/nutrition/target` is `10-trainer-features`/M8's, not M9's. M9 ships only the self-route `PUT /nutrition/targets` + the `set_by_user_id` column it reads.
- **No per-call AI rate limiting / free-tier trial** (cross-cuts § 4.3 — Tier B is binary anyway).
- **No push-delivery infra changes.** `daily_nutrition_target_hit` rows insert into `notifications`; the existing legacy Supabase trigger fans out (same contract as M7). M9 does not touch the trigger.
- **No new analytics/telemetry** beyond `ai_usage_log` (which lands as a contract stub, unwritten until M9.5).

## Deferred to M9.5 (follow-on brief — author after M9 lands)

STORY-011 (Snap photo recognition), STORY-012 (free-text LLM estimate), STORY-013 (snap recipe photo). Each gates on `aiAccess` per cross-cuts § 4.1 → 402 `ENTITLEMENT_DENIED` → caught by the M10.6 sync-queue contract. The M9.5 brief must FIRST reconcile conflict C6 (add the `aiAccess` `EntitlementFeature` member + the `useFeatureGate`/`useEntitlement` alias) before any AI handler is written, and wire `ai_usage_log` writes per cross-cuts § 4.2.

## Cross-cutting (carry into both briefs)

- **Wire-format contract.** The endpoint shapes in `BACKEND_BRIEF.md` § are the load-bearing contract; the frontend's `InMemoryApiAdapter` fixtures mirror them exactly. Drift → spec update first, then both tracks.
- **Ownership in mutation WHERE.** Every `PUT/DELETE /nutrition/entries/:id`, `PUT/DELETE /recipes/:id`, `/meals/:id` folds `userId` into the WHERE — single round-trip, 404 (don't leak existence) on wrong-user.
- **No JWT spoofing.** `userId` always from `getUser(ctx).sub`, never the body. `logged_by_user_id`/`set_by_user_id` stay NULL for self-writes in M9.
- **Offline-first is non-negotiable** (locked decision #9). Reads from SQLite cache; writes optimistic + queued via the existing `sync_queue` ([`packages/mobile/src/adapters/storage/sqlite.adapter.ts`](../../../packages/mobile/src/adapters/storage/sqlite.adapter.ts)). New `entity_type` values: see FRONTEND_BRIEF § Sync queue.
- **Perf budget per surface** is a first-class deliverable, not a nice-to-have. See FRONTEND_BRIEF § Performance budget (M11 alignment).
- **SSRF hardening** on `/recipes/import` is mandatory and fully specced in `13-nutrition-tracking/design.md` § Recipe-import SSRF guards — implement every guard, test every reject branch.
- **No secret values in any committed file** (repo is public — `feedback_repo_is_public`). Open Food Facts needs no key; the camera permission strings are public.
- **Spec-first discipline.** Spec wins over brief; flag divergence in PR review; update spec first.
