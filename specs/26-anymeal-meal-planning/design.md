# 26 — AnyMeal (AI meal planning): Design

> Companion to `requirements.md` (2026-07-24). Architecture for both tracks
> (backend + mobile), per Kiro discipline. Reuses the shipped Fuel stack
> (`specs/13-nutrition-tracking/design.md`) and the M9.5 Bedrock adapter; the
> generation pipeline deliberately mirrors AnyGym's candidate-constrained move
> (`specs/21-adaptive-workout-ai/BRIEF.md`, GTM-EXPANSION § 3 P2) so the two
> features stay architecturally twinned.

---

## 1. The generation pipeline (the core design)

Every AnyMeal AI surface (suggest, day plan, week plan, per-meal swap) runs the
same four-stage pipeline. **The model never owns numbers or safety; the
deterministic layers do.**

```
[1] CANDIDATE ASSEMBLY (deterministic, SQL)
    inputs: nutrition_preferences, nutrition_targets (or remaining-today),
            locale, run options (shape, steer, meals count, effort)
    - pool = curated locale catalogue (foods where source <> 'user'
      AND locale-curated) + user's own foods + user's recipes + meals
    - MINUS dietary-pattern exclusions (tag-based)
    - MINUS avoid list (allergen tags → tag match; dislikes → normalized
      name match; unknown-tag rows excluded from allergen-filtered pools)
    - PLUS like-list bias (flagged, not enforced)
    - capped ~150–200 candidates (id, name, kcal/P/C/F per serving,
      serving info, tags) — same cap philosophy as AnyGym's ~150 exercises
[2] AI COMPOSITION (Bedrock, forced tool use — aiEstimation.ts pattern)
    - prompt: targets/remaining budget, meal structure, effort, locale
      constraints ("UK supermarket availability…"), steer, candidate list
    - tool schema forces: meals[] → items[] each { candidateId, servings }
      + name, logSlot, reason, method? (composed recipes only)
    - model CANNOT emit macro numbers or non-candidate ingredients
[3] VERIFICATION (deterministic, server)
    - re-resolve every candidateId → recompute all macros from DB rows
    - re-run avoidanceFilter over every resolved item (defence in depth)
    - tolerance check: day total within ±7% kcal / ±10% per-macro of
      target (suggest: fits remaining budget without exceeding kcal +5%)
    - one auto-repair round-trip on failure (feedback in prompt), then:
      failing meal returned flagged (plan) or dropped (suggest)
[4] DRAFT-CONFIRM (mobile)
    - AiDraftConfirm-style review; nothing persists/logs without accept
```

Design consequences:

- **Accuracy is a database property, not a model property** — the M9.5 eval
  lesson ("never write raw model macro numbers as truth") holds by
  construction.
- **Allergen safety is enforced twice deterministically** (stages 1 and 3);
  the model is treated as an untrusted composer. `avoidanceFilter` is a pure,
  exhaustively-tested module and a **dangerous area** (CLAUDE.md sense): tag
  match on `foods.allergen_tags`/dietary-pattern tag rules + normalized
  (lowercased, singularised, accent-stripped) name matching for dislikes;
  unknown-tag foods never pass an allergen filter.
- **Composed recipes** are just `recipes` rows waiting to happen: ingredients
  are candidate `foods` rows with quantities; per-serving macros come from the
  existing recipe materialisation logic (`recipes.totalKcal…` from
  ingredients). On plan accept they insert via the existing recipe create path
  with `source = 'ai_generated'` (new enum value alongside
  `'manual' | 'url_import' | 'ai_extracted'`).

### Model + sizing

- Text-only task → **Haiku-class model first** (`AI_MEAL_MODEL_ID`, deploy-time
  config like the M9.5 ids; escalate to Sonnet-class only if composition
  quality underwhelms). No image tokens; candidate list ≈ 3–5k input tokens.
- **Suggest**: ≤600 output tokens → seconds, comfortably synchronous.
- **Day plan**: 4–6 meals ≈ 1.5–2.5k output tokens → synchronous with the
  AnyGym P2 budget (raise MAX_TOKENS, ~20s ceiling, ONE attempt + the single
  verification repair round only if time allows) under the 30s API Gateway
  ceiling.
- **Week plan (P3)**: 7 × day busts the ceiling → **async-job model** (job
  table + poll; the same infrastructure spec-20 program import needs —
  whichever lands first builds it, the other reuses; keep the job-table design
  in one place: this section defers to spec-20's design when authored, and
  vice versa).

### Cost (per checkpoint 3 ceilings, Haiku-class EU pricing)

Worst-case per-user/day (Haiku-class, ~$1/MTok in · $5/MTok out): 20 suggests
(~4k in + 0.6k out ≈ £0.006 each) + 5 day-plans (~5k in + 2.5k out ≈ £0.014
each) + 10 swaps (≈ £0.005 each) ≈ **£0.23/day → ~£7/mo ceiling-saturated** —
same order as the Snap ceiling buffer (~£7.30/mo) and comfortably inside the
£19.99 Premium+ price (the profit-buffer rule: AI cost can never equal what the
user pays; ceilings are a cost backstop, not a product quota). `ai_usage_log`
counts real inferences only (402/429 pre-checks write no row).

---

## 2. Data model (Drizzle · idempotent SQL migrations · schema.ts mirror)

### 2.1 `foods` enrichment (P0)

```
ALTER TABLE foods
  ADD COLUMN allergen_tags text[] ,        -- OFF allergens_tags, normalised ('en:milk'…)
  ADD COLUMN category_tags text[],         -- OFF categories_tags (shopping-list grouping + pattern rules)
  ADD COLUMN locale_tags  text[];          -- countries/availability ('en:united-kingdom'…), from OFF countries_tags
```

Backfill via the existing OFF seed/delta ETL (M9 `DATA_SOURCING § 5`, decided
option 2) — extend the DuckDB Parquet filter to project these tag columns;
delta cron keeps them fresh. Nullable; NULL = unknown (never treated as safe).
GIN indexes on the tag arrays for candidate-pool queries.

### 2.2 `nutrition_preferences` (P0)

```
nutrition_preferences (
  user_id uuid PK → profiles,
  dietary_patterns text[] NOT NULL DEFAULT '{}',   -- 'vegetarian'|'vegan'|'pescatarian'|'halal'|'kosher'|'dairy_free'|'gluten_free'
  avoid_allergens text[] NOT NULL DEFAULT '{}',    -- fixed vocabulary (UK FIC 14 subset), maps to allergen_tags
  avoid_foods text[] NOT NULL DEFAULT '{}',        -- free-text dislikes (normalised on write)
  liked_foods text[] NOT NULL DEFAULT '{}',
  meals_per_day integer NOT NULL DEFAULT 4 CHECK (2..6),
  effort_level text NOT NULL DEFAULT 'balanced',   -- 'quick'|'balanced'|'high_maintenance'
  locale text NOT NULL DEFAULT 'en-GB',
  updated_at timestamptz
)
```

One row per user (PK = user_id, upsert semantics like `nutrition_targets`).
"Hard to find near me" (STORY-007) appends into `avoid_foods` with a
`hardtofind:` prefix convention kept out of UI copy, and writes an
`anymeal_ingredient_feedback` row (user_id, food_id/custom name, created_at) as
the aggregate curation signal — a tiny append-only table, no UI.

### 2.3 Plans (P2)

```
meal_plans (
  id uuid PK, user_id uuid NOT NULL → profiles,
  status text NOT NULL DEFAULT 'draft',      -- 'draft'|'active'|'archived'  (draft rows GC-able)
  plan_date date NOT NULL,                   -- day plans; week = 7 rows sharing group_id (P3)
  group_id uuid,                             -- NULL for single days
  meals_per_day integer NOT NULL,
  effort_level text NOT NULL,
  target_kcal / target_protein_g / target_carbs_g / target_fat_g numeric NOT NULL,  -- snapshot of nutrition_targets at accept
  source text NOT NULL DEFAULT 'ai',
  created_by_user_id uuid → profiles,        -- future coach-authored plans; NULL/self in v1
  created_at / accepted_at timestamptz
)
UNIQUE partial: one ACTIVE plan per (user_id, plan_date)

meal_plan_meals (
  id uuid PK, plan_id uuid NOT NULL → meal_plans ON DELETE CASCADE,
  sort_order integer NOT NULL,
  label text NOT NULL,                       -- 'Meal 3 · Post-gym snack'
  log_slot text NOT NULL CHECK IN ('breakfast','lunch','snack','dinner'),
  recipe_id uuid → recipes ON DELETE SET NULL,   -- composed/saved recipe
  meal_id uuid → meals ON DELETE SET NULL,       -- user's saved meal preset
  items jsonb,                               -- one-off item lists [{foodId, servings}] when not recipe/meal-backed
  kcal / protein_g / carbs_g / fat_g numeric NOT NULL,  -- denormalised (survives source deletion)
  ai_reason text,
  state text NOT NULL DEFAULT 'planned',     -- 'planned'|'logged'|'skipped'
  logged_entry_id uuid → nutrition_entries ON DELETE SET NULL
)
```

`nutrition_entries` gains nothing: linkage lives on the plan side
(`logged_entry_id`), so the hot logging table is untouched (its slot check
constraint too — Locked decision 6).

Shopping list (P3) is **derived, not stored**: aggregate `items`/recipe
ingredients across the plan group at read time (`GET .../shopping-list`),
check-off state kept client-side in SQLite (device-local convenience, not
synced in v1).

---

## 3. Backend (Elysia · microservices/core)

New application dir: `src/application/nutrition/anymeal/` (preferences,
candidates, verification, plans, ai). All handlers: `requireAuth` →
entitlement/taster → ceiling → work; every repository method `userId`-first;
ownership checks on plan ids (`get(userId, id)` shape).

| Endpoint                                       | Notes                                                                                                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /nutrition/preferences`                   | 404-free: returns defaults when no row                                                                                                           |
| `PUT /nutrition/preferences`                   | upsert; normalises avoid/like text on write; validates vocabularies                                                                              |
| `POST /nutrition/ai/meal-suggest`              | P1. Body: `{ shape: 'snack'\|'meal'\|'either', steer?, slot? }`; reads remaining-today server-side (reuses today aggregation); pipeline § 1      |
| `POST /nutrition/ai/plan-generate`             | P2. Body: `{ planDate, mealsPerDay?, effortLevel?, steer?, includeSaved? }`; returns draft plan payload (NOT persisted — stateless like Snap)    |
| `POST /nutrition/plans`                        | P2. Accept: persists a reviewed draft (server re-verifies + recomputes before insert — clients never set macros), creates `ai_generated` recipes |
| `GET /nutrition/plans?date=` / `/plans/active` | Today view + history                                                                                                                             |
| `POST /nutrition/ai/plan-meal-swap`            | P2. Body: draft context + meal index (pre-accept) or `planMealId` (post-accept); regenerates ONE meal, holds others, ceiling-counted             |
| `POST /nutrition/plans/:id/meals/:mealId/log`  | P2. Creates the nutrition entry (existing entry service), links + flips state; offline-queueable (deterministic — no AI)                         |
| `PATCH /nutrition/plans/:id`                   | archive / re-date ("use again")                                                                                                                  |
| `DELETE /nutrition/plans/:id`                  | plan only; entries survive (SET NULL linkage)                                                                                                    |
| `GET /nutrition/plans/group/:id/shopping-list` | P3, derived aggregation                                                                                                                          |

Entitlement: new `EntitlementFeature` value `meal_ai` resolved from the tier
catalog (Premium+ flag — reuses the M19-P0 `premium_plus` row; if AnyMeal lands
first, the tier-restructure migration is a shared prerequisite, flagged in
requirements § Dependencies). Taster (if confirmed): lifetime pooled count over
the two AnyMeal AI endpoints in `ai_usage_log` vs `AI_MEAL_TASTER_LIMIT` —
exact clone of the AnyGym taster mechanism so the two pools stay separate but
identically shaped. Ceilings: `AI_MEAL_SUGGEST_DAILY_LIMIT` (20) ·
`AI_MEAL_PLAN_DAILY_LIMIT` (5) · `AI_MEAL_SWAP_DAILY_LIMIT` (10), tier-aware
resolution read-in-handler (#156 pattern, no generic limits table).

### Verification & safety testing (dangerous area)

- `avoidanceFilter` + `verifyComposition` are pure services with exhaustive
  unit tests: every dietary pattern × tagged/untagged foods, allergen
  tag-match, dislike name-match (case/plural/accent), unknown-tag exclusion,
  tolerance maths, repair-loop behaviour on injected bad model output.
- Candidate-pool SQL rendered via `PgDialect` in tests (the mocked-`getDb`
  blind-spot guard, per `reference_drizzle_groupby_param_bug`).
- Two-user isolation tests on every plan/preferences read (CLAUDE.md § User
  Data Isolation).
- Adapter tests inject canned Bedrock responses (CI never hits AWS — M9.5
  pattern), including hostile ones: non-candidate ids, allergen-violating
  compositions, macro-lying payloads — all must be caught by stage 3.

---

## 4. Mobile (packages/mobile · hexagonal)

Ports: `anymeal.port.ts` (preferences get/put, suggest, planGenerate, planCrud,
swap, logPlanMeal) → SST API adapter + SQLite storage adapter (preferences +
accepted plans cached; drafts are in-memory only). Zustand for the draft-review
state (mirror of the AnyGym review-flow store shape).

Screens/components (containers + presenters, Fuel visual language —
`nutrition.jsx` tokens):

1. **AnyMeal entry card** on Fuel (below QuickAddRow): no-plan state = "What
   should I eat?" + "Plan my day"; active-plan state = today progress strip.
2. **Preferences wizard/editor** — chips + steppers per STORY-001; also
   reachable from Fuel Targets ("Food preferences" row).
3. **Suggest sheet** (BottomSheet, Snap-parity): shape toggle + steer input →
   generating state → 2–3 suggestion cards (macros, items, reason, disclaimer
   where relevant) → Log / Save / Dismiss.
4. **Plan config sheet** → **generating** → **draft review screen**: day
   header (totals vs targets bar), meal cards (label, slot chip, macros,
   ingredients, method expand, reason line; actions Swap · Edit · Remove) →
   Accept CTA.
5. **Plan Today view** + ghost rows in the Fuel meal log (STORY-005).
6. **Shopping list screen** (P3): grouped checklist, offline check-off.

Offline: reads (preferences, active plan, shopping list) from SQLite cache;
`log` writes queue through the existing sync-queue; AI affordances disabled
offline with the Snap copy pattern. 402/429 surfaces reuse `useFeatureGate` +
the shipped upgrade sheet; taster chip copy is a conversion surface (AnyGym D3
parity).

---

## 5. Decision record

| Date       | Decision                                                                                                        | By              |
| ---------- | --------------------------------------------------------------------------------------------------------------- | --------------- |
| 2026-07-24 | Spec authored; candidate-constrained pipeline; deterministic-twice allergen posture; UK-first locale preference | Claude (w/Brad) |
| 2026-07-24 | Slots stay 4 in the log; plans carry own labels + logSlot mapping (no hot-table migration)                      | Claude proposal |
| pending    | Checkpoints 1–6 (requirements § Open checkpoints)                                                               | Brad            |
