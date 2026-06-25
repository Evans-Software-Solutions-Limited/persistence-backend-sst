# M9 — Frontend Agent Brief (Nutrition / Fuel · Tier A)

You implement the mobile track of Milestone 9. Read the parent [`BRIEF.md`](./BRIEF.md) first.

You work in [`packages/mobile/`](../../../packages/mobile/) — React Native + Expo, hexagonal architecture. You do NOT touch `microservices/core/` or `packages/db/` (backend agent's territory); read the backend wire shapes from `BACKEND_BRIEF.md` § Endpoint contracts.

**This is a port of a prototype, but greenfield in V1 terms** — there is no legacy V1 nutrition screen. The authoritative UI is the design-source prototype (present on disk):

- [`~/Downloads/handoff/design-source/screens/nutrition.jsx`](file:///Users/bradleysimms-evans/Downloads/handoff/design-source/screens/nutrition.jsx) — main Fuel screen
- [`~/Downloads/handoff/design-source/screens/fuel-targets.jsx`](file:///Users/bradleysimms-evans/Downloads/handoff/design-source/screens/fuel-targets.jsx) — Targets editor (TDEE calculator — see Conflict C2)
- [`~/Downloads/handoff/design-source/screens/fuel-sheets.jsx`](file:///Users/bradleysimms-evans/Downloads/handoff/design-source/screens/fuel-sheets.jsx) — Scan / Snap / Recipes / Quick-add sheets
- [`~/Downloads/handoff/design-source/screens/recipes.jsx`](file:///Users/bradleysimms-evans/Downloads/handoff/design-source/screens/recipes.jsx) — Recipes/Meals library + create flows
- [`~/Downloads/handoff/design-source/ui.jsx`](file:///Users/bradleysimms-evans/Downloads/handoff/design-source/ui.jsx) + [`~/Downloads/handoff/tokens.tamagui.ts`](file:///Users/bradleysimms-evans/Downloads/handoff/tokens.tamagui.ts) — primitives + tokens.

**Build to the prototype** (`feedback_prototype_first_source_of_truth`); where the spec's `requirements.md` disagrees, the prototype wins and your first commit fixes the spec.

## Authority

- Parent spec: [`../../13-nutrition-tracking/`](../../13-nutrition-tracking/).
- Architecture + offline rules: [`../../_agent.md`](../../_agent.md) (hexagonal, container/presenter, 90% coverage), [`../../../docs/mobile-v2-offline-first-plan.md`](../../../docs/mobile-v2-offline-first-plan.md).
- **Pattern references (read before writing):**
  - Cache-first read hook: [`packages/mobile/src/ui/hooks/useCachedResource.ts`](../../../packages/mobile/src/ui/hooks/useCachedResource.ts) (sync cache read → drain queue → fetch → write cache; returns `{ data, isStale, isRefreshing, error, refresh }`).
  - SQLite cache + sync queue: [`packages/mobile/src/adapters/storage/sqlite.adapter.ts`](../../../packages/mobile/src/adapters/storage/sqlite.adapter.ts) — `sync_queue` table (`entity_type, entity_id, operation, payload, endpoint, method, status` with status CHECK incl. `blocked_entitlement`), `markMutationBlocked`, `getBlockedEntries`.
  - Storage port: [`packages/mobile/src/domain/ports/storage.port.ts`](../../../packages/mobile/src/domain/ports/storage.port.ts) (`markMutationInFlight` row-conditional race guard).
  - API port + adapters: [`packages/mobile/src/domain/ports/api.port.ts`](../../../packages/mobile/src/domain/ports/api.port.ts), `adapters/api/` (`SSTApiAdapter`), the `InMemoryApiAdapter` test double.
  - Sync worker + 402 handling: `useSyncWorker` + `useAutoRetryOnUpgrade` (mounted at [`packages/mobile/app/(app)/_layout.tsx:41,47`](../../../packages/mobile/app/(app)/_layout.tsx)); the 402 → `blocked_entitlement` parse path in the sync command (`parseEntitlement`).
  - Feature gate: [`packages/mobile/src/ui/hooks/useFeatureGate.ts`](../../../packages/mobile/src/ui/hooks/useFeatureGate.ts) (NOT `useEntitlement` — see Conflict C6).
  - `<Ring>`: [`packages/mobile/src/ui/components/foundation/Ring.tsx`](../../../packages/mobile/src/ui/components/foundation/Ring.tsx) — props `{ pct, size, stroke, color, track, children, glow }`, Reanimated fill, respects reduce-motion.
  - Sheets-at-root via zustand open-state (`useDrawer().open` drives a root-mounted `<BottomSheet>`): [`packages/mobile/app/(app)/_layout.tsx:159–163`](../../../packages/mobile/app/(app)/_layout.tsx) (`feedback_sheets_mount_at_root`).
  - Tab placeholder to replace: [`packages/mobile/app/(app)/(tabs)/fuel.tsx`](../../../packages/mobile/app/(app)/(tabs)/fuel.tsx) (`<ComingSoon/>`).

## Spec alignment — first commit on the branch

Update the parent spec BEFORE implementation (single commit):

1. **`requirements.md` STORY-004 (Conflict C2)** — rewrite ACs for the TDEE-calculator Targets editor (profile strip + activity chips + goal slider auto-computing kcal/macros); **delete** the "Macro target auto-recalc from goals … No auto-tuning in v1" out-of-scope line.
2. **`requirements.md` STORY-001 AC 1.5 (Conflict C5)** — QuickAddRow is 4 buttons (Scan / Snap / Search / Recipes).
3. **`requirements.md` STORY-008 (Conflict C3)** — Import-URL is Tier-A deterministic scrape; drop the AI pill; no-microdata → graceful empty state.
4. **`design.md § Offline behaviour`** — confirm the water mutation queues an **absolute `{ cups }`** value (last-write-wins), not a delta (idempotent replay; see BACKEND_BRIEF § 4).
5. **`design.md § AI entitlement gating`** — note M9 renders Snap + auto-estimate **locked** via `useFeatureGate`; the real `aiAccess` key is M9.5's (Conflict C6).

Commit footers cite spec sections (`Implements: … § Frontend — <FuelPresenter>`, `Satisfies: requirements.md AC 1.3`, etc.).

## New dependencies (Conflict C1 — needs Brad's OK; forces an EAS dev build)

Add to `packages/mobile/package.json` (Expo SDK 55 — pin to SDK-compatible versions, run `npx expo install` to resolve):

| Dep | Why | Surface |
| --- | --- | ------- |
| `expo-camera` | Barcode scanning (STORY-002, Tier A core). Has built-in `CameraView` + `onBarcodeScanned`. | `<ScanBarcodeSheet>` |
| `@shopify/flash-list` | Perf: meal/food/recipe lists (see § Performance budget). | Lists |
| `expo-image` | Perf: recipe photos / food thumbnails with caching + blur-up. | Recipe cards, food results |
| `expo-haptics` | Water tracker +/- + add-confirm haptics (STORY-001 AC 1.7, STORY-009 AC 9.5). | Water tracker, sheet confirms |

- `expo-camera` config plugin in `app.json` adds `NSCameraUsageDescription` (iOS) + `CAMERA` (Android). **Public strings, no secrets.** Use a real copy string ("Persistence uses the camera to scan food barcodes").
- **Expo Go cannot load `expo-camera`** → barcode SMOKE_TEST steps need an EAS dev build (Brad cuts it once; surface in PR review if absent). Non-camera surfaces still run in Expo Go.
- `react-native-vision-camera` is the documented perf fallback (design.md § Risks) if `expo-camera` frame cost is too high on Android — do NOT add it pre-emptively; flag in PR review if scanning janks.

## Foundation (PR 1)

### Domain models (`src/domain/models/nutrition.ts`)

`Food`, `NutritionEntry`, `NutritionTarget`, `WaterLog`, `Recipe`, `RecipeIngredient`, `Meal`, `MealItem`, and `MealSlot = "breakfast" | "lunch" | "snack" | "dinner"`. Pure types, no framework imports. Macros are `number`. Mirror the backend wire shapes exactly.

### Domain service (`src/domain/services/nutrition.service.ts`)

Pure, fully unit-testable (no mocks):
- `computeConsumed(entries)` → `{ kcal, protein_g, carbs_g, fat_g }` (sum).
- `computeRemaining(target, consumed)` → remaining kcal.
- `macrosForServing(food|recipe, servings)` → scaled macros (used for optimistic entry creation offline).
- **TDEE calculator (Conflict C2):** `bmrMifflinStJeor({ sex, age, heightCm, weightKg })`, `tdee(bmr, activityMultiplier)`, `goalAdjustedKcal(tdee, goalSliderValue)`, `macrosFromKcal(kcal, splitPct)`. These power the Targets editor's live preview. Edge cases tested: missing profile fields, slider extremes.

### Ports (`src/domain/ports/api.port.ts` additions)

Reads: `getFuelToday(date)`, `getNutritionEntries(date)`, `getNutritionTarget()`, `getWaterToday(date)`, `getRecipes()`, `getRecipe(id)`, `getMeals()`, `searchFoods(query)`, `resolveBarcode(code)`.
Writes: `logEntry(input)`, `editEntry(id, input)`, `deleteEntry(id)`, `setTargets(input)`, `setWater(date, cups)`, `createRecipe(input)`, `importRecipeUrl(url)`, `createMeal(input)`.
Implement each in `SSTApiAdapter` (real wire) + `InMemoryApiAdapter` (fixtures matching BACKEND_BRIEF shapes exactly). **Tier-B port methods (`recognizePhoto`, `estimateText`, `extractRecipePhoto`) are NOT added in M9.**

### SQLite cache (`src/adapters/storage/` — extend `sqlite.adapter.ts`)

New cache tables, following the M4 `cached_*` pattern (user-scoped, TTL enforced by the hook layer):

| Table | Key | Holds |
| ----- | --- | ----- |
| `cached_fuel_today` | `(user_id, date)` | the full `GET /nutrition/today` payload (JSON) — the screen's primary read |
| `cached_foods` | `barcode` / `id` | resolved foods for **offline barcode fallback** (design.md § Offline behaviour) |
| `cached_recipes` | `(user_id, id)` | recipe list + detail |
| `cached_meals` | `(user_id, id)` | saved meal presets |
| `cached_nutrition_target` | `user_id` | current target (small, single row) |

- The day aggregate (`cached_fuel_today`) is the offline read source for the Fuel screen. After an optimistic write, **recompute the cached aggregate client-side** (via the domain service) so the ring updates without a round-trip.
- Offline barcode: `resolveBarcode` reads `cached_foods` first; miss + offline → return a typed "not in cache" result the sheet renders as "Food not in cache — connect to fetch from database."

### Sync queue entity types (`entity_type` values on `sync_queue`)

Add these `entity_type` strings (the queue table already exists with the right columns + `blocked_entitlement` status from M10.6 — you add new entity types, not schema):

| entity_type | operations | endpoint | offline semantics |
| ----------- | ---------- | -------- | ----------------- |
| `nutrition_entry` | create / update / delete | `/nutrition/entries[/:id]` | optimistic; recompute aggregate; LWW on edit |
| `nutrition_target` | update | `/nutrition/targets` | optimistic; LWW |
| `water_log` | set | `PATCH /nutrition/water/today` | **absolute `{ cups }`** (NOT delta) so replay is idempotent / LWW |
| `recipe` | create / update / delete | `/recipes[/:id]` | optimistic; server materialises macros on flush (reconcile on ack) |
| `meal` | create / update / delete | `/meals[/:id]` | optimistic |

- **Conflict policy** (offline-first plan § 2): server-wins / last-write-wins for v1. On flush-ack, reconcile the cached row with the server response (esp. recipe/meal `total_*` which the server computes). 
- `resolveBarcode` and `importRecipeUrl` are **online-only** (they hit external services) — do NOT queue them; show an offline notice.
- Tier-B mutations would surface as `blocked_entitlement` via the existing 402 path — **not reachable in M9** since no AI write exists yet. Don't wire it.

### Hooks (`src/ui/hooks/`)

Reads wrap `useCachedResource`: `useGetFuelToday(date)`, `useGetNutritionEntries(date)`, `useGetNutritionTarget`, `useGetWaterToday(date)`, `useGetRecipes`, `useGetRecipe(id)`, `useGetMeals`, `useSearchFoods(query)` (debounced; online-leaning), `useResolveBarcode` (online, cache-fallback).
Mutations queue-on-offline + optimistic: `useLogEntry`, `useEditEntry`, `useDeleteEntry`, `useSetTargets`, `useSetWater`, `useCreateRecipe`, `useImportRecipeUrl` (online-only), `useCreateMeal`.
Tier-B locked affordance: `useFeatureGate` for the Snap button + auto-estimate toggle (placeholder reason; the real `aiAccess` key is M9.5).

## Fuel screen + sheets (PR 2)

Container/presenter split per `_agent.md`. Presenters are pure (props only, no hooks/side-effects), fully render-testable.

### `<FuelContainer>` / `<FuelPresenter>` (replaces `<ComingSoon/>` at `app/(app)/(tabs)/fuel.tsx`)

Props per `design.md § Frontend — <FuelPresenter>`. Layout top→bottom per `nutrition.jsx`:
1. **HeaderBar** — large, eyebrow `MONDAY · MAR 25` (date-fns, user-local), trailing IconBtns: Target (→ Fuel Targets) + Calendar.
2. **`<MacroHeroPresenter>`** — `nutrition.jsx:46–105`. A **single** gold `<Ring pct={remaining/target} glow>` (decision #3) with REMAINING kcal centred (mono font), and 3 `MacroLine` rows (Protein/Carbs/Fat) each a `<Bar>` + label + `value/target unit`. Consumed/Target stat row + EDIT button at the bottom.
3. **`<QuickAddRowPresenter>`** — 4 buttons (Conflict C5): Scan / Snap (lock icon when `!aiEntitled`) / Search / Recipes.
4. **`<MealLogPresenter>`** — 4 sections (Breakfast/Lunch/Snack/Dinner); each: `<Section>` header (name + kcal sub) + Add btn + entry rows + empty state. See § Performance budget for the list strategy.
5. **`<WaterTrackerPresenter>`** — cups grid vs goal; tap a cup to set, +/- IconBtns; **`expo-haptics` `selectionAsync()` on each tap**. Auto-resets at user-local midnight (the day key in `cached_fuel_today` rolls over).

### Immediate goal-hit reward (instant — Brad 2026-06-23; design.md § Immediate in-app reward)

The durable `nutrition_streak` is confirmed at day-close by the backend cron, but the **reward must be instant** — a next-day acknowledgement demotivates. Since the screen already has `consumed` + `targets` + `remainingKcal`, the **container/presenter detect locally** when a just-logged entry brings the day's total into **`dailyKcal ± 10%`** (and per-macro), and fire an **optimistic celebration** the moment it happens: a brief in-app moment (`expo-haptics` `notificationAsync(Success)` + a ring/`MacroLine` flourish, reduce-motion respected) and today's ring marked *hit*. Pure client-side off the existing data — **no new endpoint, no server round-trip**. If later logging pushes the day back out of range, the optimistic mark clears (it's a hint, not the source of truth). Do NOT increment a persistent streak count here — that's the cron's job; this layer is celebration only.

### Sheets (mounted at root per `feedback_sheets_mount_at_root`, driven by a zustand open-state store)

- **`<ScanBarcodeSheet>`** (`fuel-sheets.jsx` ScanSheet) — `expo-camera` `CameraView` with `barcodeScannerSettings={{ barcodeTypes: ['ean13','upc_a'] }}` (on-device decode, free, no key — see [`DATA_SOURCING.md`](./DATA_SOURCING.md)), a Reanimated scanning-line (`withRepeat(withTiming(translateY, 1500))` — port the prototype's `@keyframes scan`). Debounce duplicate reads. On detect → `useResolveBarcode(code)` → food card (serving selector + meal-slot selector + Add) → `useLogEntry`. Stages: scanning → found → added. `404 barcode_not_found` → "add this food manually" path. Offline-uncached → graceful notice.
- **Open Food Facts attribution (ODbL — required).** Where a `Food.source === 'openfoodfacts'`, surface a small "Data: Open Food Facts" credit on the food-detail/confirm card, and add an "Open Food Facts" line to the Profile → About/Data-sources screen. This is a licensing obligation, not optional polish.
- **`<QuickAddSheet>`** (`fuel-sheets.jsx` QuickAddSheet) — search input over recents/foods/meals/recipes → select → serving + meal-slot (defaults to the slot that opened it) → Add. **No Tier-B "Or describe it…" CTA in M9** (defer to M9.5).
- **Snap** opens a locked upgrade placeholder (no camera, no AI) when `!aiEntitled`.

## Fuel Targets screen (PR 3)

`<FuelTargetsContainer>` / `<FuelTargetsPresenter>` at `app/(app)/fuel/targets.tsx`, per `fuel-targets.jsx` (the **TDEE calculator** — Conflict C2):
- Top bar (Cancel / "Set targets" / Save), sticky live-preview (computed kcal + goal pill + macro bar).
- Profile strip (Age/Sex/Height/Weight), activity chips (5, with multipliers), goal slider (cut↔bulk), macro editor (preset chips Maintain/Cut/Bulk/Custom + 3 macro sliders with a sum≠100 warning chip per design.md § Risks — **3-input pattern, not auto-rebalance**).
- All math via the pure `nutrition.service` TDEE functions; Save → `useSetTargets` → `PUT /nutrition/targets`.
- **Trainer-attribution banner** when `setByName` present (`set_by_user_id IS NOT NULL`, cross-cuts § 1.5): "Targets set by Coach Bradley".

## Recipes library + flows (PR 3)

Per `recipes.jsx`:
- **`<RecipesLibrary>`** — `<Segmented>` Meals / Recipes; each tab a list of cards (+ Create dropdown: Save meal / Create recipe / Snap recipe [locked, Tier B] / Import URL). FlashList (see § budget). `expo-image` for photos.
- **`<CreateRecipeManual>`** — name + photo + servings + dynamic ingredient rows (`+ Add`) + instructions. Auto-estimate-macros toggle renders **disabled/locked** (Conflict C4); server materialises macros from ingredients on save.
- **`<ImportRecipeURL>`** — URL input → `useImportRecipeUrl` → pre-fill the manual form (Tier-A scrape; no AI pill, Conflict C3). No-microdata → "couldn't read this page" state.
- **`<CreateMealFromLogged>`** — sheet showing today's logged foods grouped by slot; select → name + photo → `useCreateMeal`.

## Performance budget (M11 alignment) — a first-class deliverable

State the budget per surface in the PR description and verify on the EAS dev build:

| Surface | Budget | How |
| ------- | ------ | --- |
| **Fuel screen scroll** | 60fps, no jank | `<MealLog>` entry rows + recipe/meal/food-result lists render via **`@shopify/flash-list`** with a measured `estimatedItemSize`. The outer screen is a single FlashList (or a ScrollView with FlashLists only where item counts are unbounded — meal entries can be long for power users; recipe/meal libraries grow). Avoid nesting a VirtualizedList in a same-orientation ScrollView. |
| **Macro hero ring** | one render per macro change | Single `<Ring>` (decision #3), NOT MultiRing. Memoize the presenter; the Reanimated fill is GPU-driven. Recompute `remaining` via the memoized domain selector, not inline in render. |
| **Images** | no main-thread decode jank, cached | `expo-image` with `recyclingKey`, `cachePolicy="memory-disk"`, and a blur-up `placeholder`. Recipe/meal cards only. |
| **Barcode scanner** | cold-start < ~1s; frame cost bounded | `expo-camera` mounts only while the sheet is open (unmount on close to release the camera). Throttle `onBarcodeScanned` (debounce duplicate reads). If Android frame cost janks → flag the `react-native-vision-camera` fallback in PR review. |
| **Trend/aggregate** | cheap | The day aggregate is server-computed (`GET /nutrition/today`) + client-recomputed from cache after writes — no per-render heavy reduce over raw entries; memoize. (No weekly trend chart in M9 Tier A scope beyond what the Home ring consumes — keep it out of the Fuel screen unless the prototype shows it.) |

Also honour the `_agent.md` checklist: skeleton loaders (not spinners), optimistic UI on every mutation, reduce-motion respected by the ring + scan line.

## Quality gates (from repo ROOT)

```bash
node packages/mobile/node_modules/.bin/tsc --noEmit -p packages/mobile/tsconfig.json
node packages/mobile/node_modules/.bin/jest --projects packages/mobile --coverage   # ≥90% global, no fake tests
# eslint: run --config eslint.config.js FROM packages/mobile/ for mobile files (0 warnings)
# prettier --check <changed files> from repo ROOT
```

Tests: pure domain service (no mocks — TDEE math, macro scaling, consumed/remaining); presenters (render with props, RTL); containers (InMemoryApiAdapter + InMemoryStorageAdapter); hooks (cache-first + offline-queue + reconcile-on-ack). Mock `expo-camera`/`expo-haptics` in `jest.setup` alongside the existing native mocks.

## Files you will NOT touch

- Anything under `microservices/core/` or `packages/db/` — backend agent.
- The `sync_queue` schema / status set — you add `entity_type` values + handlers, not columns (M10.6 owns the schema).
- `useFeatureGate` / entitlement internals — consume only; the `aiAccess` reconciliation is M9.5.
- `infra/` — no SST changes.

## Inspector Brad expectations

- Offline write → optimistic aggregate recompute → reconcile on flush-ack (esp. recipe/meal `total_*`).
- Water queues absolute `{cups}` (idempotent replay), not a delta.
- Camera unmounts on sheet close (no leaked camera session / battery drain).
- FlashList `estimatedItemSize` measured, not guessed; no nested same-orientation virtualization.
- Snap + auto-estimate genuinely locked (no AI call path reachable in M9).
- Presenters pure (zero hooks); containers own all the wiring.
- Ring is a single `<Ring>`, reduce-motion respected.

## When you finish

- All gates green, ≥90% coverage, perf budget verified on the dev build.
- **Do NOT push or open a PR until Brad asks.** When told to, target `main` with the M9 reference + SMOKE_TEST link.
- Wait for `@inspector-brad` — do not pre-empt.
