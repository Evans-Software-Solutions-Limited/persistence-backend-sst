# 26 — AnyMeal (AI meal planning): Tasks

> Execution reservoir — milestone briefs cut scoped slices from here
> (`specs/_agent.md`). Every item traces to `requirements.md` ACs and
> `design.md` sections. Gates on every PR: prettier · typecheck · lint · build
> · test:unit (≥90% on changed files) + Inspector-Brad-local.
>
> **Do not start P1+ until the Brad checkpoints are answered**
> (`requirements.md § Open checkpoints` — tier gating and ceilings change
> handler code; branding changes copy everywhere).

## Phase 0 — Foundations (backend-heavy, no AI, agent-executable)

- [ ] **0.1 Migration + schema.ts: `foods` tag columns** (`allergen_tags`, `category_tags`, `locale_tags` + GIN indexes) — design § 2.1; AC 2.1. Idempotent; prod apply flagged MANUAL.
- [ ] **0.2 Seed/delta ETL extension** — project OFF `allergens_tags`/`categories_tags`/`countries_tags` in the DuckDB filter; backfill curated rows; delta cron carries tags — AC 2.1.
- [ ] **0.3 Migration + schema.ts: `nutrition_preferences`** (+ `anymeal_ingredient_feedback`) — design § 2.2; AC 1.3, 7.2.
- [ ] **0.4 `avoidanceFilter` pure service + exhaustive tests** (patterns × tags × name-match × unknown-tag) — design § 3 dangerous area; AC 2.2, 2.3.
- [ ] **0.5 Preferences endpoints** `GET/PUT /nutrition/preferences` + repository (userId-scoped, upsert, vocabulary validation, write-normalisation) + PgDialect WHERE-render test — AC 1.3.
- [ ] **0.6 Mobile: preferences port/adapter/SQLite cache + wizard & editor UI** (chips, allergen-vs-dislike distinction, disclaimer copy, skippable, Fuel Targets entry row) — AC 1.1–1.5.

## Phase 1 — Fill-my-macros suggestions (the everyday hook)

- [ ] **1.1 Candidate-assembly service** (pool query: curated locale rows + user foods/recipes/meals − pattern/avoid filters + like bias, cap ~200) + PgDialect render test — design § 1 stage 1.
- [ ] **1.2 Bedrock composition adapter** for suggest (forced tool schema: items from candidates only; `AI_MEAL_MODEL_ID` config) — design § 1 stage 2; CI on canned responses.
- [ ] **1.3 `verifyComposition` service** (macro recompute, tolerance, avoid re-check, one repair round) + hostile-payload tests — design § 1 stage 3.
- [ ] **1.4 `POST /nutrition/ai/meal-suggest`** — guard order auth → `meal_ai` entitlement/taster → `AI_MEAL_SUGGEST_DAILY_LIMIT` ceiling → pipeline; `ai_usage_log` real-inference-only — AC 3.3, 3.4, 3.6.
- [ ] **1.5 Mobile suggest sheet** (remaining-macros read, shape/steer, generating state, suggestion cards, draft-confirm → log via existing entries path, save-as-recipe/meal, offline-disabled state, 402/429 surfaces) — AC 3.1–3.7.

## Phase 2 — Day plans

- [ ] **2.1 Migrations + schema.ts: `meal_plans` + `meal_plan_meals`** (partial-unique active-per-date; `recipes.source` gains `'ai_generated'`) — design § 2.3.
- [ ] **2.2 `POST /nutrition/ai/plan-generate`** (stateless draft, N meals, ~20s/one-attempt budget, flagged-meal degradation) — AC 4.1, 4.2, 4.6.
- [ ] **2.3 Plan repository + CRUD endpoints** (accept-with-server-reverify, active/date reads, patch archive/re-date, delete with entry survival; two-user isolation tests) — AC 4.5, 5.4.
- [ ] **2.4 `POST /nutrition/ai/plan-meal-swap`** (single-meal regenerate, hold others, ceiling) — AC 4.4.
- [ ] **2.5 `POST /nutrition/plans/:id/meals/:mealId/log`** (existing entry service, linkage, offline-queueable) — AC 5.2.
- [ ] **2.6 Mobile plan flow**: config sheet → generating → draft review (meal cards, swap/edit/remove with deterministic recompute) → accept — AC 4.1, 4.3–4.5.
- [ ] **2.7 Mobile Fuel integration**: AnyMeal card states, ghost rows in meal log, plan Today/adherence view, SQLite plan cache — AC 5.1–5.3.

## Phase 3 — Week plans + shopping list (post-checkpoint 6)

- [ ] **3.1 Async-job execution model** — coordinate with spec-20 (whichever lands first builds it; single design home) — design § 1 sizing; AC 6.1.
- [ ] **3.2 Week generation** (7-day group, variety/batch-cook constraints, per-day regenerate) — AC 6.1, 6.2.
- [ ] **3.3 Shopping-list derivation endpoint + mobile checklist screen** (grouped by `category_tags`, client-side check-off) — AC 6.3.
- [ ] **3.4 Adherence week view** — AC 6.4.
- [ ] **3.5 "Hard to find near me"** affordance on ingredient rows (personal exclusion + feedback row) — AC 7.2.

## Cross-cutting (every phase)

- [ ] Disclaimer + medical-scope copy exactly per requirements (AC 1.2, 1.5, 3.4) — legal surface, no paraphrasing drift.
- [ ] Tier/taster gating verified per checkpoint answers; unauthorized-tier tests (403/402 paths).
- [ ] STATE.md + `specs/README.md` index updated as slices land.
