# 13 — Nutrition Tracking: Requirements

> **Spec rewritten from scratch on 2026-05-27** to absorb the May 2026 design package. Prior version (PR #79 — M9 Tier A + M9.5 Tier B authoring) preserved in git history.

---

## Overview

The Fuel surface — nutrition logging, macros, water, recipes, meals. Ships in two tiers:

1. **M9 Tier A** — manual log (foods + recipes + meals + water), barcode scan, macros + daily target ring, weekly trend. Local + cloud DB. No AI.
2. **M9.5 Tier B** — AI photo recognition + LLM free-text estimation. Gated behind `aiAccess` entitlement (per `_shared/cross-cuts.md § 4`).

Authoritative references:

1. `~/Downloads/handoff/design-source/screens/nutrition.jsx` — main Fuel screen
2. `~/Downloads/handoff/design-source/screens/fuel-targets.jsx` — Fuel Targets editor
3. `~/Downloads/handoff/design-source/screens/fuel-sheets.jsx` — Scan / Snap / Quick add sheets
4. `~/Downloads/handoff/design-source/screens/recipes.jsx` — Recipes + Meals library + create flows
5. `specs/_shared/cross-cuts.md` § 4 (AI entitlement) + § 5 (notifications)
6. `docs/design-port-audit.md` § Out-of-scope (Fuel placeholder)
7. Legacy V1: no nutrition surface in V1 — this is greenfield.

---

## Locked decisions

| #   | Decision                                   | Locked value                                                                                                                                                                  |
| --- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Tier split                                 | M9 = manual + barcode + macros + water. M9.5 = AI photo + LLM. AI features gate on `aiAccess` per cross-cuts § 4.                                                             |
| 2   | Fuel tab placement                         | `(app)/(tabs)/fuel.tsx` per `14-navigation`. Coach mode hides this tab.                                                                                                       |
| 3   | Macro hero ring                            | Single `<Ring>` (not MultiRing) showing remaining calories. Macro lines stacked beside it (Protein / Carbs / Fat). Per `nutrition.jsx:46–105`.                                |
| 4   | Meal log structure                         | 4 fixed meals: Breakfast / Lunch / Snack / Dinner. Per `nutrition.jsx MealLog`. Each meal section: header with kcal total + add CTA + collapsed log entries.                  |
| 5   | Recipes vs Meals                           | Recipes = ingredient lists + instructions (chef-style). Meals = saved combinations of logged foods (user-style — "my usual lunch"). Two-tab segmented inside Recipes library. |
| 6   | Water tracker                              | Tap +/- with haptic. Goal default 8 cups; configurable. Auto-resets daily.                                                                                                    |
| 7   | Cross-cut: nutrition target set by trainer | `PUT /trainers/me/clients/:clientId/nutrition/target` owned by `10-trainer-features` per cross-cuts § 1.2; this spec owns the underlying `PUT /nutrition/targets` self-route. |
| 8   | Streak: nutrition_streak                   | Daily; period satisfied when daily kcal within target ± 10% per cross-cuts § 3.1. Gated on this spec shipping.                                                                |
| 9   | Offline-first                              | All reads from SQLite cache; all writes queue + optimistic. Same V2 pattern as other M-features.                                                                              |
| 10  | AI gating                                  | Every AI inference call asserts `aiAccess` per cross-cuts § 4.1. Failure → 402 + `ENTITLEMENT_DENIED` payload. Mobile sync queue handles 402 per M10.6 contract.              |

---

## User stories — M9 Tier A

### STORY-001: As an athlete, I want a Fuel screen with macro rings + meal log + water tracker

**Acceptance Criteria:**

- 1.1 [ ] Route `(app)/(tabs)/fuel.tsx` renders `<FuelContainer>` (replacing `<ComingSoon/>` from `14-navigation`).
- 1.2 [ ] Header per `nutrition.jsx:19–28`: `<HeaderBar large title="Fuel" eyebrow="MONDAY · MAR 25" trailing={<IconBtn icon={<IconTarget/>} onPress={openTargets}/> + <IconBtn icon={<IconCalendar/>}/>}/>`.
- 1.3 [ ] `<MacroHero>` per `nutrition.jsx:46–105`: large `<Ring pct={remaining/target}>` (gold) showing REMAINING kcal in the centre, with stacked macro lines (Protein/Carbs/Fat) on the right showing `<MacroLine label value target unit color>` each.
- 1.4 [ ] CONSUMED · TARGET stat row at the bottom of the hero (per `nutrition.jsx:66–105`) with EDIT button → opens Fuel Targets screen.
- 1.5 [ ] `<QuickAddRow>` per `nutrition.jsx QuickAddRow`: 3-button strip — Scan (Barcode) / Snap (AI photo — Tier B gated) / Recipes.
- 1.6 [ ] `<MealLog>` per `nutrition.jsx MealLog`: 4 sections (Breakfast/Lunch/Snack/Dinner). Each section: header (`<Section>` with name + kcal sub) + Add Btn + collapsed list of entries logged for that meal.
- 1.7 [ ] `<WaterTracker>` per `nutrition.jsx WaterTracker`: tappable +/- bottle icons up to current count vs goal. Haptic on each tap. Auto-resets daily.

### STORY-002: As an athlete, I want to log a food via barcode scan

**Acceptance Criteria:**

- 2.1 [ ] Tap Scan → opens `<ScanBarcodeSheet>` `<BottomSheet>` at 78% height per `fuel-sheets.jsx`.
- 2.2 [ ] Sheet uses `expo-camera` (or `react-native-vision-camera` if perf needs) with barcode scanner overlay + scanning-line animation.
- 2.3 [ ] On barcode detected, calls `useResolveBarcode({ code })` → server lookup against Open Food Facts (or in-house barcode DB).
- 2.4 [ ] Show food card with name + brand + macros + serving size selector + meal selector (which meal slot) + Add Btn.
- 2.5 [ ] Submit fires `POST /nutrition/entries` (manual entry payload). Offline: queues.
- 2.6 [ ] Sheet closes with affirmation.

### STORY-003: As an athlete, I want to log a food manually via Quick Add

**Acceptance Criteria:**

- 3.1 [ ] Tap Add on a meal section header → opens `<QuickAddSheet>` per `fuel-sheets.jsx QuickAddSheet`.
- 3.2 [ ] Sheet content: search input (searches user's recent foods + recipes + meals + barcode DB) → results list → tap to select.
- 3.3 [ ] After selection: serving size input, meal slot (defaults to the one that opened the sheet), Add Btn.
- 3.4 [ ] Submit fires `POST /nutrition/entries`.
- 3.5 [ ] Offline: queues + optimistic.

### STORY-004: As an athlete, I want to set my macro + calorie targets

**Acceptance Criteria:**

- 4.1 [ ] Route `(app)/fuel/targets.tsx` renders `<FuelTargetsContainer>` per `fuel-targets.jsx`.
- 4.2 [ ] Form fields: daily calorie target (numeric, kcal), macro split (% Protein / Carbs / Fat — auto-balances to 100), water goal (cups/day).
- 4.3 [ ] Preset presets: "Maintain", "Cut", "Bulk", "Custom".
- 4.4 [ ] Submit fires `PUT /nutrition/targets`.
- 4.5 [ ] If targets set by trainer (`set_by_user_id IS NOT NULL` per cross-cuts § 1.5), show banner: "Targets set by Coach Bradley".
- 4.6 [ ] Form pre-populates from current target if exists.

### STORY-005: As an athlete, I want a Recipes + Meals library

**Acceptance Criteria:**

- 5.1 [ ] Route `(app)/fuel/recipes.tsx` renders `<RecipesLibraryContainer>` per `recipes.jsx`.
- 5.2 [ ] Two-tab `<Segmented>`: Meals / Recipes. Each tab lists user's saved entries.
- 5.3 [ ] Each entry: card with name + ingredients summary + total kcal + tap to view / edit.
- 5.4 [ ] Top right: + Create Btn → opens dropdown menu (per `recipes.jsx AddRecipeMenu`): Manual / Import URL / Snap photo / From logged.
- 5.5 [ ] Reads: `useGetRecipes`, `useGetMeals`.

### STORY-006: As an athlete, I want to create a recipe manually

**Acceptance Criteria:**

- 6.1 [ ] Route `(app)/fuel/recipes/create.tsx` renders `<CreateRecipeManualContainer>` per `recipes.jsx CreateRecipeManual`.
- 6.2 [ ] Fields: name, photo (optional), servings count, ingredients list (each: food/quantity/unit), instructions textarea.
- 6.3 [ ] Server computes per-serving macros from ingredient totals / servings.
- 6.4 [ ] Submit fires `POST /recipes`.

### STORY-007: As an athlete, I want to create a meal from currently logged foods

**Acceptance Criteria:**

- 7.1 [ ] From Meals tab → + → "From logged" → opens `<CreateMealFromLoggedSheet>` per `recipes.jsx CreateMealManual`.
- 7.2 [ ] Sheet shows today's logged foods grouped by meal; user selects which to save as a Meal preset.
- 7.3 [ ] Name + photo (optional) + Save → `POST /meals`.

### STORY-008: As an athlete, I want to import a recipe from a URL

**Acceptance Criteria:**

- 8.1 [ ] Route `(app)/fuel/recipes/import.tsx` renders `<ImportRecipeURLContainer>` per `recipes.jsx ImportFromURL`.
- 8.2 [ ] URL input → submit → server scrapes structured recipe data (Schema.org Recipe microformat / `ld+json`). M9 ships the **deterministic scrape only** (Conflict C3); no AI pill, no LLM fallback.
- 8.3 [ ] Pre-fills the manual-create form with scraped data; user reviews + saves.
- 8.4 [ ] Endpoint: `POST /recipes/import` (server-side recipe-scraping service, SSRF-hardened per design.md § Recipe-import SSRF guards).
- 8.5 [ ] A page with no `Recipe` microdata → server returns `422 no_recipe_microdata`; the FE shows a graceful "couldn't read this page" state (no crash). The LLM fallback defers to M9.5.

### STORY-009: As an athlete, I want to log water intake

**Acceptance Criteria:**

- 9.1 [ ] `<WaterTracker>` per `nutrition.jsx`. Tap each cup icon to increment; long-press to decrement (or per-cup -1 IconBtn).
- 9.2 [ ] Goal cups: 8 default; settable in Fuel Targets.
- 9.3 [ ] Auto-resets at user-local midnight.
- 9.4 [ ] Each tap fires `POST /nutrition/water { cups }` (or `PATCH /nutrition/water/today { delta: ±1 }`).
- 9.5 [ ] Haptic on each tap.

### STORY-010: As an athlete, my nutrition_streak advances when daily kcal falls within target ± 10%

**Acceptance Criteria:**

- 10.1 [ ] Per cross-cuts § 3.1, `nutrition_streak` is daily; period satisfied when daily total within target ± 10% tolerance.
- 10.2 [ ] The nightly 02:00 UTC streak cron evaluates `nutrition_streak`: it computes the most-recently-completed user-local day's kcal total vs `nutrition_targets.daily_kcal ± 10%` and advances the streak when satisfied (then runs the standard miss/freeze/break sweep). No on-write evaluation on `POST /nutrition/entries` — the daily total is volatile until the day ends.
- 10.3 [ ] Achievement triggers + `streak_milestone` notifications per the same pattern as other streaks. On a satisfied day a `daily_nutrition_target_hit` notification fires **only when the user's preference is on** (default off per cross-cuts § 5). The `daily_nutrition_target_hit` enum value is added by an M9 `ALTER TYPE` migration sequenced before the cron emit.

## User stories — M9.5 Tier B

### STORY-011: As an athlete with aiAccess, I want to snap a photo of my meal and have it auto-recognised

**Acceptance Criteria:**

- 11.1 [ ] Tap Snap (in QuickAddRow) → checks `useEntitlement('aiAccess')`. If not entitled, shows upgrade prompt per cross-cuts § 4.1 (HTTP 402 from gating endpoint surfaces this).
- 11.2 [ ] If entitled, opens `<SnapAISheet>` per `fuel-sheets.jsx SnapAISheet` — camera capture button.
- 11.3 [ ] Capture → uploads to `POST /nutrition/ai/recognize-photo` (multipart). Endpoint asserts `assertEntitlement(userId, 'aiAccess')` per cross-cuts § 4.1 + logs to `ai_usage_log` per § 4.2.
- 11.4 [ ] Server returns recognised items with confidence scores; sheet shows them as editable cards.
- 11.5 [ ] User confirms selection → submit fires `POST /nutrition/entries` with the recognised items.
- 11.6 [ ] Snap-recognising animation per `fuel-sheets.jsx` (pulsing "Recognizing…" with sparkles icon).

### STORY-012: As an athlete with aiAccess, I want to estimate calories from a free-text description

**Acceptance Criteria:**

- 12.1 [ ] In `<QuickAddSheet>`, after search, offer "Or describe it…" CTA → opens text input.
- 12.2 [ ] Submit fires `POST /nutrition/ai/estimate-text` with the text. Same `aiAccess` gating + `ai_usage_log` write.
- 12.3 [ ] LLM returns macro estimate with confidence + reasoning.
- 12.4 [ ] User reviews + accepts; entry created.

### STORY-013: As an athlete, I want to snap a recipe photo to import a recipe from a magazine / cookbook

**Acceptance Criteria:**

- 13.1 [ ] From Recipes > + → Snap photo → opens `<SnapRecipePhotoSheet>` per `recipes.jsx SnapRecipePhoto`.
- 13.2 [ ] AI gating + ai_usage_log per the same pattern.
- 13.3 [ ] OCR + LLM extract structured recipe; pre-fill manual create form.
- 13.4 [ ] Endpoint: `POST /recipes/ai/extract-photo`.

---

## Out of scope

- **Per-call rate limiting on AI** — `aiAccess` is binary in v1 per cross-cuts § 4.3.
- **Free-tier AI trial (e.g. "5 free recognitions")** — same.
- **Macro target auto-recalc from goals** — set via Targets screen explicitly. No "based on your weight goal" auto-tuning in v1.
- **Nutrition coach AI** (separate Tier B+ feature) — out of scope.
- **Trainer-on-behalf nutrition entry logging** (Tier C / M9.5+) — endpoint specced per cross-cuts § 1.2 but deferred to a later milestone. M8 ships `PUT /nutrition/target` only.

---

## Dependencies and what this spec unlocks

**Depends on:**

| Spec                        | What's consumed                                                                                                                                                                   |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `01-design-system`          | `<Ring>`, `<Card>`, `<Btn>`, `<IconBtn>`, `<Pill>`, `<BottomSheet>`, `<Segmented>`, `<SearchBar>`, `<Section>`, `<Stat>`, `<MicroPill>`, `<Bar>`, mono font, tokens, Lucide icons |
| `14-navigation`             | Fuel tab slot — replaces `<ComingSoon/>`                                                                                                                                          |
| `_shared/cross-cuts.md`     | § 1 (trainer nutrition target write — cross-cut into `10-trainer-features`), § 4 (AI entitlement), § 5 (notifications)                                                            |
| `11-payments-subscriptions` | `useEntitlement('aiAccess')` hook from M10.5                                                                                                                                      |

**Unlocks:**

| Downstream spec       | What it can do once 13 lands                                                                                                                         |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `06-progress-goals`   | Fuel ring on Home gets real data; nutrition_streak plugs into the streak engine                                                                      |
| `10-trainer-features` | Trainer can edit nutrition targets via `PUT /trainers/me/clients/:clientId/nutrition/target` (cross-cut writes through this spec's underlying table) |

---

## Open questions

None. All 10 decisions locked.

---

_End of `13-nutrition-tracking/requirements.md` · 2026-05-27 (rewritten from scratch)_
