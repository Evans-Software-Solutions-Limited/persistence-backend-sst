# 26 — Mealprint (AI meal planning): Tasks

> Execution reservoir — milestone briefs cut scoped slices from here
> (`specs/_agent.md`). Every item traces to `requirements.md` ACs and
> `design.md` sections. Gates on every PR: prettier · typecheck · lint · build
> · test:unit (≥90% on changed files) + Inspector-Brad-local.
>
> **Checkpoints all resolved (Brad, 2026-07-24)** — see
> `requirements.md § Open checkpoints`. Build is unblocked end-to-end:
> Premium+ hard gate (no taster), ceilings 20/5/10, branding confirmed,
> **Phase 3 is v1 scope** (async-job infra in-scope; coordinate with
> spec-20).

## Phase 0 — Foundations (backend-heavy, no AI, agent-executable)

- [x] **0.1 Migration + schema.ts: `foods` tag columns** (`allergen_tags`, `category_tags`, `locale_tags` + GIN indexes) — design § 2.1; AC 2.1. Idempotent; prod apply flagged MANUAL.
- [x] **0.2 Seed/delta ETL extension** — project OFF `allergens_tags`/`categories_tags`/`countries_tags` in the DuckDB filter; backfill curated rows; delta cron carries tags — AC 2.1.
- [x] **0.3 Migration + schema.ts: `nutrition_preferences`** (+ `mealprint_ingredient_feedback`) — design § 2.2; AC 1.3, 7.2.
- [x] **0.4 `avoidanceFilter` pure service + exhaustive tests** (patterns × tags × name-match × unknown-tag) — design § 3 dangerous area; AC 2.2, 2.3.
- [x] **0.5 Preferences endpoints** `GET/PUT /nutrition/preferences` + repository (userId-scoped, upsert, vocabulary validation, write-normalisation) + PgDialect WHERE-render test — AC 1.3.
- [ ] **0.6 Mobile: preferences port/adapter/SQLite cache + wizard & editor UI** (chips, allergen-vs-dislike distinction, disclaimer copy, skippable, Fuel Targets entry row) — AC 1.1–1.5.

## Phase 1 — Fill-my-macros suggestions (the everyday hook)

- [x] **1.1 Candidate-assembly service** (pool query: curated locale rows + user foods/recipes/meals − pattern/avoid filters + like bias, cap ~200) + PgDialect render test — design § 1 stage 1.
- [x] **1.2 Bedrock composition adapter** for suggest (forced tool schema: items from candidates only; `AI_MEAL_MODEL_ID` config) — design § 1 stage 2; CI on canned responses.
- [x] **1.3 `verifyComposition` service** (macro recompute, tolerance, avoid re-check, one repair round) + hostile-payload tests — design § 1 stage 3.
- [x] **1.4 `POST /nutrition/ai/meal-suggest`** — guard order auth → `meal_ai` entitlement (hard gate, no taster) → `AI_MEAL_SUGGEST_DAILY_LIMIT` ceiling → pipeline; `ai_usage_log` real-inference-only — AC 3.3, 3.4, 3.6.
- [ ] **1.5 Mobile suggest sheet** (remaining-macros read, shape/steer, generating state, suggestion cards, draft-confirm → log via existing entries path, save-as-recipe/meal, offline-disabled state, 402/429 surfaces) — AC 3.1–3.7.

## Build log

**Phase 0 backend + Phase 1 backend SHIPPED 2026-08-03** on branch
`feat/mealprint-phase-0-1` (`76596e7d`, `863e40d4`, `52b93df0`). ⚠ The ticks
above cover the BACKEND half only — **0.6 and 1.5 are the mobile half and are
NOT built.** They are PR 2 on the same branch.

Landed beyond the checklist, so it is not re-derived:

- **`mealprint_access` is granted to `premium_plus` ONLY**, unlike
  `loadout_access` (all three trainer tiers). No coach surface exists in v1 and
  `individual_trainer` is already the most cost-exposed tier. This forced a real
  fix in `pickUpgradeTier`: its role branch assumed every Premium+ feature is
  also granted to trainer tiers, so a denied coach would have been sold
  `individual_trainer` (£14.99) and stayed locked out — `PREMIUM_PLUS_ONLY_FEATURES`
  now beats the role branch.
- **`avoidanceFilter` is two-tier**: allergens are tag-derived and fail closed
  (null tags, unreadable tags, and unclassifiable `en:` tags all exclude; no word
  list may vouch for an allergen). Patterns and dislikes use category tags plus a
  name-token channel with per-axis free-from negation (`negators` for "gluten
  free" phrasings, `clearedBy` for "vegan"/"plant-based" markers). The category
  channel is UNCONDITIONAL — an allergen tag's silence is not evidence of
  absence, because OFF rows are routinely partially tagged.
- **`halal`/`kosher` carry `partialEnforcementOnly`.** Certification is not in
  OFF and must not be implied.
- **Retrieval ordering is protein density**, deterministically. A product
  judgement, not a proven optimum — measure it before arguing about it.
- **Three empty states are 200s with an `emptyReason`** (`no_targets`,
  `budget_exhausted`, `no_candidates`), none consuming the ceiling.
  `no_candidates` is the EXPECTED state until the tag backfill runs.

⚠ **The `foods` tag backfill is a RE-SEED, and Mealprint does not work without
it.** Tag values exist only in the OFF dump, so the route is re-running
`seedOpenFoodFacts.ts` with the widened DuckDB projection (in that file's
header). Until then every curated food is unknown-allergen and excluded from
allergen-filtered pools.

⚠ **Three migrations need a MANUAL production apply**: `20260803120000`
(foods tags), `20260803120100` (preferences), `20260803120200`
(mealprint_access).

## Phase 2 — Day plans

- [ ] **2.1 Migrations + schema.ts: `meal_plans` + `meal_plan_meals`** (partial-unique active-per-date; `recipes.source` gains `'ai_generated'`) — design § 2.3.
- [ ] **2.2 `POST /nutrition/ai/plan-generate`** (stateless draft, N meals, ~20s/one-attempt budget, flagged-meal degradation) — AC 4.1, 4.2, 4.6.
- [ ] **2.3 Plan repository + CRUD endpoints** (accept-with-server-reverify, active/date reads, patch archive/re-date, delete with entry survival; two-user isolation tests) — AC 4.5, 5.4.
- [ ] **2.4 `POST /nutrition/ai/plan-meal-swap`** (single-meal regenerate, hold others, ceiling) — AC 4.4.
- [ ] **2.5 `POST /nutrition/plans/:id/meals/:mealId/log`** (existing entry service, linkage, offline-queueable) — AC 5.2.
- [ ] **2.6 Mobile plan flow**: config sheet → generating → draft review (meal cards, swap/edit/remove with deterministic recompute) → accept — AC 4.1, 4.3–4.5.
- [ ] **2.7 Mobile Fuel integration**: Mealprint card states, ghost rows in meal log, plan Today/adherence view, SQLite plan cache — AC 5.1–5.3.

## Phase 3 — Week plans + shopping list (IN v1 — decided 2026-07-24)

- [ ] **3.1 Async-job execution model** — coordinate with spec-20 (whichever lands first builds it; single design home) — design § 1 sizing; AC 6.1.
- [ ] **3.2 Week generation** (7-day group, variety/batch-cook constraints, per-day regenerate) — AC 6.1, 6.2.
- [ ] **3.3 Shopping-list derivation endpoint + mobile checklist screen** (grouped by `category_tags`, client-side check-off) — AC 6.3.
- [ ] **3.4 Adherence week view** — AC 6.4.
- [ ] **3.5 "Hard to find near me"** affordance on ingredient rows (personal exclusion + feedback row) — AC 7.2.

## Cross-cutting (every phase)

- [ ] Disclaimer + medical-scope copy exactly per requirements (AC 1.2, 1.5, 3.4) — legal surface, no paraphrasing drift.
- [ ] Tier gating (Premium+ hard gate) verified; unauthorized-tier tests (403/402 paths).
- [ ] STATE.md + `specs/README.md` index updated as slices land.
