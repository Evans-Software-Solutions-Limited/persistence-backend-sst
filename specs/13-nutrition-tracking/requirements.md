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

## Revised 2026-07-01 — STORY-004 AC corrections (Fuel Targets editor implementation)

Landed alongside the Fuel Targets editor build. Two ACs were stale against decisions already recorded elsewhere in this spec set (`design.md § Risks`, `FRONTEND_BRIEF.md`'s Conflict C2 resolution) but never reconciled back into the AC text itself — corrected here per the spec-first discipline (`specs/_agent.md`).

- **AC 4.2 corrected** — was: "macro split (% Protein / Carbs / Fat — **auto-balances to 100**)". This contradicted `design.md § Risks` ("Macro autobalance UX in Fuel Targets — sliders that auto-rebalance can confuse users → Use 3-input pattern + warning chip when sum ≠ 100; not auto-adjust"), which `FRONTEND_BRIEF.md` had already resolved in the auto-rebalance's favor of the Risks entry but the AC text was never updated to match. **Corrected AC 4.2**: daily calorie target (numeric, kcal), macro split (% Protein / Carbs / Fat as 3 independent inputs — no auto-rebalance), a visible warning + a disabled Save when the three don't sum to 100%, water goal (cups/day).
- **AC 4.6 scope note** — "Form pre-populates from current target if exists" is satisfied for `waterCups` only. The calculator's other inputs (activity level, goal-slider position, macro-mode selection) are NOT persisted columns on `nutrition_targets` (only the computed `dailyKcal`/`proteinG`/`carbsG`/`fatG`/`waterCups`/`preset` are) — the editor is a "compute fresh from the profile" tool each time it opens, matching the design-source prototype (`fuel-targets.jsx` has no session-restore concept). Reverse-deriving a percentage split + activity/goal position from a saved kcal+grams target was considered and deferred — it adds a real amount of complexity (mode-validity checks, an effect racing the profile/target fetch lifecycle) for a convenience the user resolves in a few taps by re-selecting their preset/activity. Flagged as a known, disclosed scope line rather than a silent gap; picking it up later is additive (no rework needed).
- **Macro-preset naming**: superseded — see the 2026-07-01 (device-test correction) entry below.
- **Not in the design-source prototype**: `fuel-targets.jsx` has no water-goal field at all, despite AC 4.2 requiring one and `SetTargetsInput.waterCups` being a mandatory field on the wire type. The shipped editor adds a minimal cups stepper (droplet icon + ± controls) consistent with the app's existing water iconography — not a prototype port, since there was nothing to port.

---

## Revised 2026-07-01 (device-test correction) — AC 4.3 named the wrong control

The initial STORY-004 AC-correction pass above (same date) misread `fuel-targets.jsx` as having ONE preset control and reconciled it against `design.md § Risks`'s "no auto-rebalance" directive by adopting the goal slider's own labels ("Maintain/Cut/Bulk/Custom") as the macro-preset chip set. On device testing this was flagged as wrong: the prototype has **two independent controls**, not one:

1. **Goal slider** — cut ↔ bulk (calorie deficit/surplus), labelled via `goalLabel()`: "Aggressive cut / Cut / Maintain / Lean bulk / Aggressive bulk". Unaffected by this correction — already correct.
2. **Macro-balance preset chips** — protein/carb/fat RATIO, independent of the goal slider: "Recommended" (dynamic, tracks the goal slider via `recommendedSplit()`), "High protein" (40/30/30), "Balanced" (30/40/30), "Low carb" (35/20/45), "Custom".

**AC 4.3 corrected**: preset chips are "Recommended", "High protein", "Balanced", "Low carb", "Custom" — restored to prototype naming and preset count (`nutrition.service.MacroPresetMode`/`MACRO_PRESETS`/`presetSplit`). `design.md § Risks`'s "no auto-rebalance" directive still applies and is unaffected by this correction — it governs slider-DRAG behaviour within Custom mode (each of the 3 sliders moves only its own field), not preset naming or count. The sum-≠-100% warning chip and Save-gating logic are also unaffected.

---

## Revised 2026-07-02 — STORY-004 manual calorie mode (Brad-requested)

Post-sign-off feedback on the shipped Fuel Targets editor: the calculator was the ONLY way to arrive at a daily kcal target. Users who already know their number (from a coach, another app, or preference) — or whose profile is too incomplete for Mifflin-St Jeor — had no way to set targets by hand.

**New AC 4.8**: the editor has a calorie-mode toggle — "Calculator" (default, the existing TDEE flow) and "Set my own" (a direct numeric kcal input, sanity-bounded 500–10,000). In manual mode the profile strip / activity chips / goal slider are hidden (nothing is being calculated) but the macro-split editor (AC 4.2/4.3 — preset chips + Custom sliders) applies identically to the typed kcal. An out-of-range entry shows an inline warning and blocks Save via the same `kcal === null` contract as an incomplete profile. Switching into manual with an empty field seeds it from the live calculated kcal (falling back to the saved target's `dailyKcal`); a value the user typed survives toggling modes within the session.

**Persistence unchanged**: `nutrition_targets` still stores only the result (`dailyKcal`/macros/`waterCups`/`preset`) — no "source" column. Re-opening the editor starts back in calculated mode, consistent with the AC 4.6 scope note above (the editor is a compute-fresh tool, not a session restore). Not in the design-source prototype (which is calculator-only); deviation explicitly requested by Brad 2026-07-02.

---

_End of `13-nutrition-tracking/requirements.md` · 2026-05-27 (rewritten from scratch) · Revised 2026-07-01 (STORY-004 AC corrections) · Revised 2026-07-01 (device-test correction) · Revised 2026-07-02 (manual calorie mode)_

---

## Revised 2026-07-03 — M9.5 Tier B is LAUNCH SCOPE (photo + free-text); eval-locked decisions

Brad's call 2026-07-03: Tier B "Snap" ships end-to-end as launch scope, not a research spike. STORY-011 (photo) and STORY-012 (free-text) are in scope for M9.5; **STORY-013 (recipe-photo extract) stays deferred** to a later slice.

### Phase 0 accuracy eval (2026-07-03) — decisions locked

25 ground-truth photos (22 measured Nutrition5k cafeteria plates + 3 packaged items), 3 Claude models on AWS Bedrock (eu-west-2), direct estimation vs foods-table grounding. Full artifacts in the session eval; summary:

| arm                      | abs kcal err median | p90  | confidence signal                        | cost/snap (EU) |
| ------------------------ | ------------------- | ---- | ---------------------------------------- | -------------- |
| claude-opus-4-6 direct   | 30%                 | 72%  | calibrated (conf ≥ 0.7 → 12% median err) | ~$0.019        |
| claude-sonnet-4-6 direct | 33%                 | 88%  | noisy                                    | ~$0.014        |
| claude-haiku-4-5 direct  | 32%                 | 119% | uninformative (always ~0.8)              | ~$0.004        |

- **Provider: AWS Bedrock with IAM auth** (Brad 2026-07-03) — no API-key secret exists anywhere; the Lambda gets `bedrock:InvokeModel` on the two model ARNs. Claude Opus 4.8/4.7 are account-gated on Bedrock; `eu.anthropic.claude-opus-4-6-v1` is the top available rung (same price class).
- **Photo model: `claude-opus-4-6`** — best tail accuracy and the only model whose per-item confidence is calibrated enough to drive the prototype's confidence UX. **Free-text model: `claude-haiku-4-5`** (no image tokens; easier task; ~$0.002/call). Model ids are deploy-time config, not hardcoded.
- **NO automated foods-table grounding in v1.** The eval showed grounding _degrades_ accuracy on every model (opus 30% → 40% median) because the OFF-seeded `foods` table contains junk-name rows and wrong-nutriment products. The AI's numbers go on the draft card directly; the user can manually replace any item with a DB food via the existing search affordance.
- **Structured output = forced tool use** (`tool_choice`), not `output_config.format` — the latter is fragmented/unsupported across Bedrock endpoints.

### STORY-011 AC corrections (photo)

- **11.3 corrected**: endpoint is **`POST /nutrition/ai/estimate`** with a JSON body `{ imageBase64, mediaType, mealType? }` — NOT multipart (see design.md § M9.5 Tier B revision for the transport justification). Client downscales/compresses before upload. Entitlement assert + `ai_usage_log` unchanged.
- **11.4 expanded**: response items render as an **editable draft card** (per `fuel-sheets.jsx SnapSheet` confirm stage): per-item name / amount / kcal / confidence %, toggleable; items with confidence below the default-untick threshold (0.7) start **unticked**. AI output is NEVER logged without explicit user confirm.
- **11.5 unchanged** (confirm → `POST /nutrition/entries`).
- **11.7 new — offline**: Snap is online-only. When offline the Snap affordance is disabled with "Snap needs a connection — try Quick Add instead". AI calls never enter the sync queue.
- **11.8 new — failure UX**: model refusal / unparseable output → `422 ai_unreadable`; provider outage/timeout → `503 ai_unavailable`. Sheet shows "Couldn't read this photo — try Quick Add instead" with a retry. `ai_usage_log` row is written on failures too.
- **11.9 new — permissions**: the `expo-camera` plugin's `NSCameraUsageDescription` currently only covers barcode scanning; string widens to cover meal photos (forces a new EAS dev build). Photo-library pick is also offered (uses existing library permission, string widened to cover meal photos).

### STORY-012 AC corrections (free-text)

- **12.2 corrected**: endpoint `POST /nutrition/ai/estimate-text` body `{ description }`, same gating/logging/response envelope as photo; runs on the cheaper text model.
- **12.4 expanded**: output feeds the same editable draft card + confirm flow as photo. Never auto-logged.

### Entitlement key reconciliation (closes M9 Conflict C6)

Backend `EntitlementFeature` gains **`ai_access`** with a REAL check (latest sub → tier → `subscription_tiers.ai_access`), replacing the stub-allow path for these two endpoints; the mobile mirror union (`domain/models/entitlement.ts`) gains the same member. The 402 wire payload is the SHIPPED M10.5/M10.6 contract — `{ code: 'ENTITLEMENT_DENIED', error, feature: 'ai_access', reason, current_tier, upgrade_to, upgrade_price_monthly }` — NOT cross-cuts § 4.1's never-shipped `{ entitlement: 'aiAccess', upgradeUrl }` draft (cross-cuts carries a matching Revised 2026-07-03 amendment). Mobile's strict 402 parser (`parseEntitlement.ts`) and `useNutritionAiGate` (already evaluates `tier.aiAccess` client-side) then work unchanged. Flag for Brad: `premium` is currently the only tier with `ai_access=true` — trainer tiers have it false; confirm intended.

### Abuse ceiling (pending Brad sign-off; deviation from cross-cuts § 4.3)

A server-side **daily AI-call ceiling (30/day/user across both endpoints)** returning `429 { code: 'AI_DAILY_LIMIT' }`, implemented as a count over today's `ai_usage_log` rows. This is NOT a product quota tier (still out of scope) — it is a cost-abuse backstop so per-user spend mathematically cannot exceed subscription revenue. If Brad declines, ships without it.
