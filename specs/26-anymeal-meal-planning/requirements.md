# 26 — AnyMeal (AI meal planning): Requirements

> **Authored 2026-07-24** from Brad's scoping session (Premium+ nutrition
> support). "AnyMeal" is the working brand — the nutrition sibling of AnyGym
> (one word, same naming system; availability/trademark check pending, same as
> `marketing/WEBSITE_PRICING_SPEC.md § 5` requires for AnyGym). This spec covers
> the **meal-inspiration + food-plan layer on top of the shipped Fuel stack**
> (`specs/13-nutrition-tracking` is authoritative for logging, targets, recipes,
> barcode and Snap AI — this spec composes them, it does not redefine them).
>
> Spec slot: `26` is the next free number (21 = adaptive-workout-ai, 22/23
> reserved for GTM-EXPANSION milestones, 24 = coach-authoring, 25 =
> coach-client-offboarding).

---

## Overview

Users have calorie + macro targets (Fuel Targets, shipped) and a logging surface
(Fuel, shipped) — but the app never answers the actual daily question: **"what
should I eat?"** Brad's own framing: he has targets and no inspiration; hitting
protein with the calories left after dinner is a puzzle; snacks that fit the
remaining budget are guesswork; and generic recipe apps suggest ingredients that
don't exist in UK supermarkets (the canonical example: cartoned liquid egg
whites — a US staple, hard to find in the UK).

AnyMeal closes that gap in two shapes:

1. **Fill-my-macros suggestions** (the everyday hook): "I have 620 kcal and 42g
   protein left today — give me a snack/dinner idea I'd actually eat." One tap
   from Fuel, answers in seconds, respects the avoidance list, logs in one tap.
2. **Food-plan generation** (the flagship): a day (later: week) of meals built
   to hit the user's targets — structured around their preferred number of
   meals, dietary requirements, food avoidances and preferences, effort level
   (quick-and-simple vs batch-prep "high maintenance"), with real recipes and
   UK-available ingredients. Reviewed, edited, then accepted — never
   auto-logged.

### Market context (researched 2026-07-24)

- **Eat This Much** is the only mainstream app that truly generates plans from
  scratch (calorie target + macro split + diet type + exclusions + number of
  meals). It is the functional benchmark for the plan generator.
- **MyFitnessPal Premium+** ($24.99/mo · $99.99/yr) makes its Meal Plan Builder
  and automatic grocery lists the top-tier flagship — validating meal planning
  as a premium-tier anchor at exactly our Premium+ price band. Its grocery
  integration is **US-only**; its meal planner is region-limited. **UK-first is
  open ground.**
- **MacroFactor** — the strongest lifter-focused tracker — has **no meal
  planning at all** ("what to eat" is explicitly left to the user). A
  lifting-first app that answers "what should I eat" is differentiated.
- **Lifesum** offers themed plans (keto, Mediterranean…), not custom generation
  against the user's own macro targets.
- **Safety is the sharp edge:** studies repeatedly find AI/consumer apps
  unreliable on allergens (one JAMA-cited review: ~78% of free nutrition apps
  failed basic allergen-flagging). The design conclusion (mirrored in Locked
  decision 2): **the model never owns exclusion — deterministic filtering does,
  and allergy-grade avoidance always carries a "check the label" disclaimer.**

### Relationship to AnyGym

Same product thesis, same architecture move. AnyGym adapts training to the
equipment you actually have; AnyMeal adapts eating to the targets, tastes and
supermarket you actually have. Both use **candidate-constrained AI**: the
deterministic layer assembles verified candidates and owns all numbers; the
model only composes and explains; output is always a draft the user confirms.
Marketing-wise the two form the Premium+ "adaptive suite" pair.

---

## Locked decisions (proposed at authoring — ⚠ marks Brad checkpoints)

| #   | Decision              | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | AI shape              | **Candidate-constrained composition.** Deterministic layer pre-filters foods/recipes (locale, dietary pattern, avoidances, macro fit) and computes ALL macro numbers from the verified `foods` DB; the model selects/composes from candidates and writes names, portions-as-multipliers, and reasons only. Never pure "AI invents a meal with AI macros."                                                                                                                                                 |
| 2   | Avoidance enforcement | **Deterministic, twice.** Avoidances/dietary pattern filter the candidate pool BEFORE the model, and a server-side verification pass re-checks every ingredient of every proposed meal AFTER the model. A verification failure never reaches the user silently. Allergy-grade items additionally always render the label-check disclaimer.                                                                                                                                                                |
| 3   | Draft-confirm         | AI output is never logged or persisted as active without explicit user confirmation — same rule as Snap AI and AnyGym (`AiDraftConfirmPresenter` pattern).                                                                                                                                                                                                                                                                                                                                                |
| 4   | Tier gating           | ⚠ **Premium+** for plan generation (joins the adaptive suite next to AnyGym). Fill-my-macros suggestions: proposal = also Premium+ with a **lifetime taster pool** (N free, env-tunable) as the conversion hook. NB the AnyGym taster mechanism was specced (GTM § 3 P0) but the shipped site copy later dropped it (pricing spec: Free's cap is "3 Custom Workouts") — so the taster question is genuinely open for BOTH features. Checkpoint: Brad decides suggestion tier + whether any taster exists. |
| 5   | Localisation          | **UK-first.** v1 ships `en-GB` only, but locale is a stored preference from day 1. Candidate pool draws from the UK-curated OFF seed (shipped, M9 `DATA_SOURCING § 5`); prompts carry UK-availability constraints; users can flag "hard to find here" on any ingredient, which feeds their personal exclusions (and, aggregated, the curation backlog).                                                                                                                                                   |
| 6   | Meal-slot mapping     | Plans support **2–6 meals/day** but the shipped Fuel log keeps its 4 fixed slots (`breakfast/lunch/snack/dinner`, DB check constraint untouched). Plan meals carry their own label ("Meal 3 · Post-gym snack") plus a `logSlot` mapping; multiple plan meals may map to one slot (the log already allows multiple entries per slot). No hot-table migration.                                                                                                                                              |
| 7   | Recipes source        | No licensed third-party recipe DB in v1. Plan meals are (a) the user's own recipes/meals, (b) AI-composed simple recipes whose ingredients are verified `foods` rows (macros computed server-side), or (c) curated system recipes (system-owned rows, same pattern as template workouts #257) added over time. Ingredient-level grounding beats recipe APIs.                                                                                                                                              |
| 8   | Reuse                 | `nutrition_targets` is the single source of targets (no separate plan targets editor — plans snapshot it). `recipes`/`meals`/`foods`/`nutrition_entries` are reused as-is. Bedrock adapter (M9.5 `aiEstimation.ts` pattern), entitlement + `ai_usage_log` ceilings (#156 pattern) reused.                                                                                                                                                                                                                 |
| 9   | Offline posture       | Generation/suggestion are **online-only** (same as Snap: AI calls never enter the sync queue). Accepted plans and preferences are cached in SQLite and fully readable offline; log-from-plan writes queue offline like any manual entry.                                                                                                                                                                                                                                                                  |
| 10  | Medical scope         | AnyMeal is a lifestyle/fitness feature. **No medical-diet claims** (renal, diabetic dosing, ARFID etc.), no medical-condition inputs, and a persistent "not medical advice / consult a professional" line in the preferences flow. Dietary requirements are patterns + exclusions, not prescriptions.                                                                                                                                                                                                     |

---

## User stories — P0 (foundations: preferences + data)

### STORY-001: As an athlete, I want a dietary profile so every suggestion respects how I actually eat

**Acceptance Criteria:**

- 1.1 [ ] A Food Preferences surface (entry points: Fuel → AnyMeal card first-run wizard, and Fuel Targets screen → "Food preferences" row) captures:
  - **Dietary pattern** (single-select): none · vegetarian · vegan · pescatarian · halal · kosher · dairy-free · gluten-free — extensible enum, multi-select for the compatible subset (e.g. vegetarian + gluten-free).
  - **Avoid list**: chip-based add of (a) allergen-grade groups from a fixed vocabulary (peanuts, tree nuts, shellfish, egg, dairy, gluten, soy, sesame, fish — the UK FIC 14-allergen set is the ceiling) and (b) free-text dislikes ("mushrooms", "olives").
  - **Like list** (free-text + chips): foods to bias toward ("chicken thighs", "greek yogurt", "rice").
  - **Meals per day**: 2–6 (default 4, mirroring the Fuel slots).
  - **Effort level**: Quick & simple · Balanced · High-maintenance (batch-prep, more cooking).
- 1.2 [ ] Allergen-grade avoid chips are visually distinct from dislikes and adding one shows the persistent disclaimer: "AnyMeal filters known ingredients, but always check labels — it can't verify allergens or cross-contamination."
- 1.3 [ ] Preferences persist server-side (`GET/PUT /nutrition/preferences`), are cached in SQLite, editable any time, and every AnyMeal generation reads the live values.
- 1.4 [ ] The wizard is skippable; sensible defaults apply (no pattern, empty lists, 4 meals, Balanced effort).
- 1.5 [ ] Medical-scope line (Locked decision 10) is shown in the wizard footer.

### STORY-002: As the system, I need allergen/category data on foods so avoidance filtering is deterministic

**Acceptance Criteria:**

- 2.1 [ ] The OFF-seeded `foods` catalogue gains allergen tags and category tags (from OFF `allergens_tags`/`categories_tags`) via the existing seed/delta ETL — new columns, idempotent migration, backfill for existing curated rows.
- 2.2 [ ] User-created foods and AI-recognized foods without tags are treated as **unknown** (never assumed safe): they pass dislike filtering by name-match only and are flagged in any allergen-filtered context.
- 2.3 [ ] A pure, unit-tested `avoidanceFilter` service implements pattern/allergen/dislike matching (tags first, normalized name-match fallback) — this is a **dangerous-area module** with exhaustive tests (see design § Safety verification).

## User stories — P1 (fill-my-macros suggestions)

### STORY-003: As an athlete, I want meal/snack ideas that fit what I have left today

**Acceptance Criteria:**

- 3.1 [ ] Fuel screen exposes an AnyMeal suggestion affordance ("What can I eat?") that reads today's remaining kcal/protein/carbs/fat from the shipped today view.
- 3.2 [ ] The sheet offers a shape choice (Snack · Meal · Either) and optional free-text steer ("something sweet", "using chicken I have in").
- 3.3 [ ] `POST /nutrition/ai/meal-suggest` returns 2–3 suggestions, each: name, why-it-fits reason, composed items (each resolving to a `foods`/`recipes` row + quantity), and macro totals **computed server-side from the composed rows**, fitting the remaining budget within tolerance (design § Verification).
- 3.4 [ ] Every suggestion passed the avoidance verification; allergen-relevant suggestions render the label-check disclaimer inline.
- 3.5 [ ] One tap logs a suggestion into a chosen slot via the existing `POST /nutrition/entries` path (draft-confirm first — no silent log); "save as recipe/meal" is offered where the shape warrants it.
- 3.6 [ ] Gating per Locked decision 4 (402 upgrade surface when not entitled; taster pool if confirmed) and a per-endpoint daily ceiling (429 `ai_daily_limit`, #156 pattern).
- 3.7 [ ] Offline: affordance disabled with "needs a connection" copy (Snap parity).

## User stories — P2 (day-plan generation)

### STORY-004: As an athlete, I want AnyMeal to build my day of eating against my targets

**Acceptance Criteria:**

- 4.1 [ ] From the AnyMeal surface: "Plan my day" — config sheet pre-filled from preferences (meals count, effort, pattern summary + edit link) plus per-run options: which day, "include my saved recipes/meals" toggle, free-text steer.
- 4.2 [ ] `POST /nutrition/ai/plan-generate` (synchronous, single day) returns a **draft plan**: N meals, each with label, target `logSlot`, composed recipe/items (candidate-constrained), per-meal macros and a day total hitting the active `nutrition_targets` within tolerance.
- 4.3 [ ] The draft renders as reviewable meal cards (ingredients + simple method for composed recipes, macros, why-this reason). Nothing persists as active until accept.
- 4.4 [ ] Per-meal actions in review: **swap** (regenerate that meal only, holding the others and re-balancing its macro share), **edit** (adjust portions/remove items — macros recompute deterministically), **remove**.
- 4.5 [ ] **Accept** persists the plan (`meal_plans` + `meal_plan_meals`), saves net-new composed recipes into the user's recipe library (marked AI-sourced), and sets the plan active for its date.
- 4.6 [ ] Generation failures degrade gracefully: unparseable/unsafe output → 422 with retry copy; partial verification failure → the failing meal returns flagged for swap, never silently included.
- 4.7 [ ] Gating: Premium+ (or per checkpoint) + its own daily ceiling; only real inferences consume quota.

### STORY-005: As an athlete, I want my active plan on the Fuel screen, one tap from logged

**Acceptance Criteria:**

- 5.1 [ ] With an active plan for today, Fuel's meal-log sections surface the planned-but-unlogged meals for their mapped slot as ghost/suggestion rows ("Planned: Chicken & rice bowl · 640 kcal — Log it").
- 5.2 [ ] "Log it" writes the plan meal through `POST /nutrition/entries` (denormalised macros, links `planMealId`), marks the plan meal logged, and works offline (queued).
- 5.3 [ ] A plan Today view shows adherence at a glance (planned vs logged per meal, day totals vs targets).
- 5.4 [ ] Plans can be viewed, re-used for another day ("use again"), archived, deleted; deleting a plan never touches logged entries (denormalised macros, `SET NULL` linkage).

## User stories — P3 (week plans + shopping list)

### STORY-006: As an athlete, I want a week of meals and the shopping list to cook it

**Acceptance Criteria:**

- 6.1 [ ] "Plan my week" generates a 7-day plan (variety constraints across days; effort level governs batch-cook repetition) via the **async-job model** (busts the 30s sync ceiling — shared infrastructure decision with spec-20 program import; see design § Sizing).
- 6.2 [ ] Week review supports the same per-meal swap/edit before accept; per-day regenerate.
- 6.3 [ ] An accepted plan produces an aggregated **shopping list** (ingredients summed across the plan, grouped by category, check-off UX, offline-capable). No retailer integration in v1 (UK supermarket APIs are closed; MFP's equivalent is US-only — deferred moat, revisit post-launch).
- 6.4 [ ] Adherence week view (logged-vs-planned) rolls up from STORY-005 data.

### STORY-007: As a UK athlete, ingredients suggested to me are actually available here

_(Phase note: ACs 7.1 and 7.3 are pipeline properties delivered from P1 onward —
they live in candidate assembly, design § 1 stage 1. Only the 7.2 affordance
ships in P3.)_

**Acceptance Criteria:**

- 7.1 [ ] Generation prompts constrain to locale-available ingredients (v1: UK supermarket framing; the cartoned-egg-white class of US-staples is excluded via prompt + curation).
- 7.2 [ ] Any ingredient row in any AnyMeal surface offers "Hard to find near me" → adds to the user's personal exclusions immediately and records the signal (aggregate curation backlog).
- 7.3 [ ] The candidate pool for composition draws only from locale-curated catalogue rows + the user's own foods/recipes.

---

## Out of scope (v1)

- **Grocery-delivery/retailer integration** (no open UK supermarket APIs; MFP's is US-only). The shopping list is self-contained.
- **Pantry/leftovers modelling** and cost optimisation (Eat This Much-style pantry is a v2 lever).
- **Coach-authored client meal plans** (a coach assigns a plan to a client) — deliberately deferred but designed-for (the plan model carries `createdByUserId`; the trainer-on-behalf pattern from cross-cuts § 1 fits). This is the coach/B2B lever; own spec when picked up.
- **Micronutrients** (fibre/sodium/vitamins) — macros only, like the rest of Fuel.
- **Medical diets** (Locked decision 10).
- **Restaurant/eating-out suggestions.**
- **Non-UK locales** (structure ships, catalogues don't).

---

## Dependencies and unlocks

**Depends on:** `13-nutrition-tracking` (Fuel surface, targets, entries, recipes/meals, Snap AI patterns) · `11-payments-subscriptions` + M12 IAP (Premium+ tier exists in catalog per M19-P0 — if AnyMeal lands before AnyGym's P0 tier restructure, that P0 becomes a shared prerequisite) · M9 `DATA_SOURCING` (OFF seed + ETL).

**Unlocks:** Premium+ value proposition beyond AnyGym (two flagship features, one tier) · coach meal-plan assignment (future spec) · nutrition adherence data for the coach AI weekly summary.

---

## Open checkpoints for Brad

1. **Branding**: "AnyMeal" final? (Availability/trademark check alongside AnyGym's.)
2. **Tier gating** (Locked decision 4): suggestions tier + taster pool size; plan generation Premium+-only?
3. **Ceilings**: proposed defaults — suggest 20/day, plan-generate 5/day, swap 10/day (all env-tunable, cost-bounded under the £19.99 price; design § Cost).
4. **Marketing site**: add AnyMeal to the Premium+ card copy (currently AI Workout Suggestions / AnyGym scan / Program import)?
5. **Allergen vocabulary**: sign off the fixed allergen chip set (UK FIC 14) + disclaimer copy.
6. **P3 timing**: week plans + shopping list ride v1 or fast-follow? (Async-job infra is the cost — shared with spec-20.)
