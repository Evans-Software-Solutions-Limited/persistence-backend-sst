# M9 — Backend Agent Brief (Nutrition / Fuel · Tier A)

You implement the backend track of Milestone 9. Read the parent [`BRIEF.md`](./BRIEF.md) first.

You work in the SST v3 / Elysia / Neon / Drizzle backend at [`microservices/core/`](../../../microservices/core/) + [`packages/db/`](../../../packages/db/). You do NOT touch `packages/mobile/` (frontend agent's territory). You may read `packages/mobile/src/domain/ports/api.port.ts` for contract context only.

## Authority

- Parent spec: [`../../13-nutrition-tracking/`](../../13-nutrition-tracking/) — `requirements.md` (STORY-001→010), `design.md` (everything except `nutrition/ai/*` + `recipes/ai/*`), `tasks.md` (Phases 13.1, 13.2, 13.3; not 13.4).
- Cross-cuts: [`../../_shared/cross-cuts.md`](../../_shared/cross-cuts.md) § 1.1/1.5, § 3.1, § 5.
- Architecture rules: [`../../../CLAUDE.md`](../../../CLAUDE.md) (SST + Elysia + Neon + Drizzle + JWT + explicit ownership).
- Workflow: [`../../_agent.md`](../../_agent.md) — spec-first, always.
- **Pattern references (read before writing):**
  - Route registration + literal-before-`:id` ordering: [`microservices/core/src/api.ts`](../../../microservices/core/src/api.ts).
  - A clean feature slice (handler → service decorator → repository, userId-first, ownership in WHERE): [`microservices/core/src/application/goals/get/goalsGetHandler.ts`](../../../microservices/core/src/application/goals/get/goalsGetHandler.ts), [`.../repositories/goalService.ts`](../../../microservices/core/src/application/repositories/goalService.ts), [`.../repositories/goalRepository.ts`](../../../microservices/core/src/application/repositories/goalRepository.ts).
  - Schema + enum + table: [`packages/db/src/schema.ts`](../../../packages/db/src/schema.ts) (`notificationTypeEnum` ~line 143–159; `userGoals` ~760–787 for the table/index idiom).
  - Migration format (idempotent, DO-block for `CREATE TYPE`, additive): [`supabase/migrations/20260607120100_m4_progress_schema.sql`](../../../supabase/migrations/20260607120100_m4_progress_schema.sql).
  - Streak engine + cron: [`infra/api.ts:89`](../../../infra/api.ts) (`streakCron`, `cron(0 2 * * ? *)`), [`microservices/core/src/streakCron.ts`](../../../microservices/core/src/streakCron.ts), [`microservices/core/src/application/streaks/{evaluate.ts,cron.ts}`](../../../microservices/core/src/application/streaks/).
  - External-fetch + secret-binding idiom: [`microservices/core/src/application/stripe/stripeClient.ts`](../../../microservices/core/src/application/stripe/stripeClient.ts) (lazy singleton + `getEnv`); secret wiring in [`infra/api.ts`](../../../infra/api.ts) + [`infra/secrets.ts`](../../../infra/secrets.ts).
  - Test idiom (mock `getDb`, replicate the Drizzle chain, `__tests__/` colocation): [`.../repositories/__tests__/goalRepository.test.ts`](../../../microservices/core/src/application/repositories/__tests__/goalRepository.test.ts). **Mocked-DB blind spot:** unit tests mock `getDb`, so a malformed SQL expression ships green. For any query with `GROUP BY` / aggregates, render it through `PgDialect` in a test and assert the SQL string (per `reference_drizzle_groupby_param_bug` — a reused parameterized `sql\`\``in SELECT+GROUP BY throws Postgres 42803 at runtime; group by ordinal).`GET /nutrition/today` aggregation is the at-risk query here.

## Spec alignment — first commit on the branch

Update the parent spec BEFORE implementation (single commit), per `_agent.md` rule 3:

1. **`design.md` § Backend endpoints** — the table is already there; flesh out each Tier-A endpoint's request/response/status shapes from § Endpoint contracts below. Mark the `nutrition/ai/*` + `recipes/ai/*` rows "**deferred to M9.5**".
2. **`design.md` § Import-URL (Conflict C3)** — state M9 ships deterministic Schema.org/`ld+json` scrape only; no-microdata → `422 no_recipe_microdata`; LLM fallback deferred to M9.5. Remove the implication that the M9 import is AI.
   2b. **`design.md` § Data sources (new section)** — capture the [`DATA_SOURCING.md`](./DATA_SOURCING.md) outcome: Open Food Facts is the M9 food DB (free, no key, ODbL → attribution required, 15 req/min/IP → cache-first mandatory, custom User-Agent mandatory, JSONL-dump ingest as the v2 scale lever).
3. **`requirements.md`** — confirm STORY-002→010 ACs map 1:1 to SMOKE_TEST steps; add the `422 no_recipe_microdata` AC to STORY-008.
4. **`tasks.md`** — mark 13.1, 13.2, 13.3 M9-scoped; 13.4 deferred.

Every implementation commit cites spec sections in the footer:

```
Implements: specs/13-nutrition-tracking/design.md § Backend endpoints > POST /nutrition/entries
Closes: specs/13-nutrition-tracking/tasks.md § Phase 13.2 (T-13.2.1)
Satisfies: specs/13-nutrition-tracking/requirements.md AC 3.4
```

If the spec disagrees with this brief or with implementation reality, **stop and update the spec first** as its own commit.

## Scope

Recommended commit order (may split into 2–3 PRs on the branch): **migration → repositories → today/entries → targets → water → barcode/foods → streak hook → recipes → meals → OFF seed + delta cron (§ 9, own PR)**. Each ships its own tests with 90% branch coverage on touched files.

### 0. Migration block (additive, idempotent)

One migration file `supabase/migrations/<timestamp>_m9_nutrition_schema.sql`, top comment block per the M4 example. SQL is authoritative in `13-nutrition-tracking/design.md § Database schema` — transcribe it, with these requirements:

- **FK-dependency order** (Postgres has no forward-declared FKs): `foods` → `recipes` → `recipe_ingredients` → `meals` → `meal_items` → `nutrition_entries` → `nutrition_targets` → `water_log` → `ai_usage_log`.
- Every `CREATE TABLE IF NOT EXISTS`, every `CREATE INDEX IF NOT EXISTS`.
- The indexes from design.md: `nutrition_entries_user_date (user_id, logged_at DESC)`, `nutrition_entries_user_slot_date (user_id, meal_slot, logged_at DESC)`, `ai_usage_log_user_ts (user_id, created_at DESC)`. Add `foods_barcode_idx` (the `barcode UNIQUE` already implies one) and `recipes_user_idx (user_id)`, `meals_user_idx (user_id)`.
- `nutrition_entries.meal_slot` keeps the `CHECK (meal_slot IN ('breakfast','lunch','snack','dinner'))`.
- `nutrition_entries` ships `logged_by_user_id`, `ai_estimated DEFAULT false`, `ai_confidence` columns **now** (per cross-cuts § 1.1 + § 6 — built-in from day 1, unused until M8/M9.5).
- `nutrition_targets` ships `set_by_user_id` **now** (M8 writes it via the trainer cross-cut). `nutrition_targets.user_id` is the PK (one target row per user).
- `water_log` has `UNIQUE (user_id, logged_date)`.
- **`ai_usage_log` lands now as a contract stub** (cross-cuts § 4.2) — table created, never written until M9.5.
- **Enum extension (coordinate with `09-notifications-social` per cross-cuts § 5):**
  ```sql
  ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'daily_nutrition_target_hit';
  ```
  `daily_nutrition_target_hit` is NOT in the live enum ([`packages/db/src/schema.ts`](../../../packages/db/src/schema.ts) ~143–159 — confirmed values end at `freeze_token_applied`). **`ALTER TYPE … ADD VALUE` cannot run inside the same transaction as a statement that uses the new value, and is not transactional in older PG** — put it in its own migration statement, sequenced BEFORE the streak hook that emits it. The cross-cuts taxonomy table + the mobile `NotificationType` union were already updated (per design.md § Notification triggers — PR #76); you only own the DB enum line. Also add `dailyNutritionTargetHit` to `notificationTypeEnum` in `schema.ts`.

Update `packages/db/src/schema.ts` with all 9 tables (Drizzle table defs mirroring the SQL, snake_case columns → camelCase TS, `numeric()` for the macro columns, `uuid().primaryKey().defaultRandom()`, FK `.references(() => …, { onDelete: "cascade" })` where design.md uses `ON DELETE CASCADE`).

> **Numeric note:** Drizzle `numeric()` returns `string` in TS. Decide once: parse to `number` at the repository boundary (recommended — keeps the wire shape numeric) and document it. Macro math (kcal totals, ±10% streak tolerance) must use numbers, not string concatenation. Add a repo-level test asserting `kcal` comes back as a `number`.

### 1. `GET /nutrition/today` — Fuel screen aggregate

Path `microservices/core/src/application/nutrition/today/`. Returns everything the Fuel screen needs in one round-trip:

```typescript
{
  data: {
    date: string;            // YYYY-MM-DD (user-local; accept ?date=, default = server today)
    targets: NutritionTarget | null;
    consumed: { kcal: number; protein_g: number; carbs_g: number; fat_g: number; water_cups: number };
    remainingKcal: number;   // targets.daily_kcal - consumed.kcal (0 if no target)
    entriesBySlot: { breakfast: NutritionEntry[]; lunch: NutritionEntry[]; snack: NutritionEntry[]; dinner: NutritionEntry[] };
  }
}
```

- `consumed` is a SUM aggregate over `nutrition_entries` for `(userId, date)` — **this is the GROUP-BY-risk query; PgDialect-render test it.** Group/aggregate by ordinal or distinct `sql\`\`` instances, never a reused parameterized expression.
- `water_cups` joins `water_log` for `(userId, logged_date)`.
- Empty day → `consumed` all-zero, `entriesBySlot` four empty arrays.

### 2. `/nutrition/entries` — CRUD

`microservices/core/src/application/nutrition/entries/{list,create,update,delete}/`. Repository `nutritionEntryRepository.ts`, service decorator `nutritionEntryService.ts`.

- `GET /nutrition/entries?date=YYYY-MM-DD` → `{ data: NutritionEntry[] }`, `created_at`/`logged_at DESC`.
- `POST /nutrition/entries` — body validated with `t.Object`:

  ```typescript
  {
    foodId?: string; recipeId?: string; mealId?: string;  // at least one, or a one-off custom payload
    mealSlot: "breakfast" | "lunch" | "snack" | "dinner";
    servings: number;
    // denormalised macros (client computes from the food/recipe × servings; server re-validates if foodId given)
    kcal: number; protein_g: number; carbs_g: number; fat_g: number;
    loggedAt: string;
  }
  ```

  - **Server re-derives macros** when `foodId`/`recipeId`/`mealId` is present (don't trust client math blindly — recompute from the referenced row × servings, store the server value). For a true one-off (no reference), accept the client macros.
  - `mealSlot` via `t.Union([t.Literal("breakfast"), …])`.
  - `logged_by_user_id` = NULL (self-write; M9 has no on-behalf route).
  - Returns `{ data: NutritionEntry }`.

- `PUT /nutrition/entries/:id` — edit servings/slot/macros. **Ownership folded into WHERE** (`and(eq(id), eq(userId))`); null → 404.
- `DELETE /nutrition/entries/:id` — same ownership-in-WHERE; null → 404.

### 3. `/nutrition/targets` — GET + PUT (self only)

`microservices/core/src/application/nutrition/targets/`. Repository `nutritionTargetRepository.ts`.

- `GET /nutrition/targets` → `{ data: NutritionTarget | null }` (null if never set). When `set_by_user_id IS NOT NULL`, include the setter's `profiles.full_name` as `setByName` so the FE banner (cross-cuts § 1.5) renders without a second call (corrected 2026-07-06 — shipped `nutritionTargetRepository` already reads `full_name`).
- `PUT /nutrition/targets` — upsert on `user_id` (PK). Body: `{ dailyKcal, proteinG, carbsG, fatG, waterCups, preset }`. **Self-write only: `set_by_user_id` stays untouched** (NULL on first self-set; the trainer route in M8 is the only writer of a non-null `set_by_user_id`). Returns the upserted row.
- **Do NOT build `PUT /trainers/me/clients/:clientId/nutrition/target`** — that's `10-trainer-features`/M8. M9 ships only the column + the self-route.

### 4. `/nutrition/water/today` — GET + PATCH

`microservices/core/src/application/nutrition/water/`. `waterLogRepository.ts`.

- `GET /nutrition/water/today?date=YYYY-MM-DD` → `{ data: { cups: number, goal: number } }` (`goal` from `nutrition_targets.water_cups`, default 8).
- `PATCH /nutrition/water/today` — body `{ delta: 1 | -1 }` OR `{ cups: number }` (pick one; **recommend `{ delta }`** to match the haptic +/- UX and make the queued offline replay commutative-ish — but note: deltas are NOT idempotent on replay, so the sync queue must dedupe or the handler must accept an absolute `cups` set for the flush path. **Decision: support both** — `{ cups }` is the authoritative set used by the sync flush; `{ delta }` is a convenience the FE may avoid in favour of optimistic-local-then-set). Upsert on `(user_id, logged_date)`; clamp `cups >= 0`.

> **Offline-replay note for the FE contract:** because increments aren't idempotent, the FRONTEND_BRIEF specifies the water mutation queues an **absolute `{ cups }`** value (last-write-wins), not a delta. Document this in `design.md § Offline behaviour`.

### 5. `/nutrition/barcode/resolve` + `/foods`

`microservices/core/src/application/nutrition/barcode/` + `.../foods/`.

- `POST /nutrition/barcode/resolve` — body `{ code: string }`. **Read [`DATA_SOURCING.md`](./DATA_SOURCING.md) before implementing — the OFF rate limit dictates this design.**
  1. Look up `foods WHERE barcode = code`. Hit → return it. **This cache-first step is load-bearing, not an optimization** — see below.
  2. Miss → fetch **Open Food Facts** (`https://world.openfoodfacts.org/api/v2/product/<code>.json`) server-side. **No API key needed** (public). Lazy-singleton fetch idiom per `stripeClient.ts`. `AbortSignal.timeout(8000)`. On 404/no-product → `404 barcode_not_found` (the FE lets the user add the food manually).
  3. On OFF hit → INSERT a `foods` row (`source = 'openfoodfacts'`, map OFF `nutriments` → kcal/protein/carbs/fat/serving) → return it.
  - Returns `{ data: Food }`.
  - **MANDATORY OFF compliance (per DATA_SOURCING.md § 2):**
    - **Custom User-Agent** on every OFF request: `Persistence/<appVersion> (<contact-email>)`. Missing/generic UA → throttled or banned. Pull the contact from config, not hard-coded secrets (it's public, but keep it configurable).
    - **Rate-limit defence.** OFF allows only **15 product reads/min/IP**, and our Lambda concentrates ALL users' scans on one egress IP — naive proxying gets us IP-banned at scale. The `foods` cache (step 1) is the primary mitigation: only true misses hit OFF. ALSO add **exponential backoff on HTTP 429** and a circuit-breaker that returns `barcode_not_found` (graceful — user adds manually) rather than retrying into a ban. Do NOT add an unbounded retry loop.
    - **ODbL attribution.** OFF data is Open Database License — attribution is required. Note in `design.md § Data sources` that the FE must credit Open Food Facts (food-detail sheet + an About/Data-sources line); the BE returns `source` on each `Food` so the FE knows when to show it.
  - **Bulk seed — IN SCOPE for M9 (Brad confirmed 2026-06-21; see DATA_SOURCING.md § 5 + § 9 below).** Don't rely on lazy cache-fill alone — seed `foods` from the OFF **Parquet** dump up front so offline barcode works from day 1 and the live rate-limit risk is gone. Scoped as a dedicated seed/ETL script + a delta-refresh cron, in its **own PR/commit**, NOT inside the resolve-endpoint handler. Full mirror remains overkill — curated subset only.
  - **Consider USDA FoodData Central** (public domain — no ODbL, free key) as a complementary source for _generic/whole_ foods on the search/manual path — cleaner licensing than OFF for non-barcoded items. Optional for M9 (the base `/foods` search hits our own table); flag in PR review if you seed generic foods from it. See DATA_SOURCING.md § 3.
- `GET /foods?query=` — search `foods` by `name ILIKE %query%` (+ the user's own `source='user'` rows), limit 50. `{ data: Food[] }`.
- `POST /foods` — user creates a custom food (`source = 'user'`, `created_by = userId`). `{ data: Food }`.

> **Open Food Facts is an external network hop but NOT user-controlled-URL** (the code is the only input, the host is fixed) — so it does **not** need the full SSRF guard. Just timeout + size cap + error handling. The SSRF guard is for `/recipes/import` only.

### 6. Streak hook — `nutrition_streak`

Per `design.md § Streak engine integration` + cross-cuts § 3.1. Daily; period satisfied when daily kcal total ∈ target ±10%.

- **No on-write evaluation** (daily total is volatile until day ends — design.md says skip the `POST /entries` hook). The nightly cron owns it.
- Extend the existing streak cron ([`microservices/core/src/application/streaks/cron.ts`](../../../microservices/core/src/application/streaks/cron.ts), wired at [`infra/api.ts:89`](../../../infra/api.ts), 02:00 UTC) to evaluate `nutrition_streak`:
  - For each user with a `nutrition_streak` row + a `nutrition_targets` row: compute the prior user-local day's kcal total (use `profiles.timezone`, default `Europe/London`, same as the other streak types per cross-cuts § 3.4); within `daily_kcal ± 10%` → period satisfied → advance; else → freeze-token check / break per § 3.5.
  - On advance to a milestone threshold (7/14/28/60/90 days, cross-cuts § 3.6) → insert `user_achievements` + fire `streak_milestone` notification (existing path).
  - On a satisfied day → emit `daily_nutrition_target_hit` notification **only if the user's preference is on** (default **off** per cross-cuts § 5 — so this is effectively opt-in; respect `profiles.notification_preferences`).
- **Sequencing:** the `ALTER TYPE … ADD VALUE 'daily_nutrition_target_hit'` migration MUST be applied before this cron path can emit, or the first `INSERT INTO notifications` 500s with `invalid input value for enum`.
- Tests: feed kcal totals at boundary (exactly target, +9%, +11%, -9%, -11%) → assert advance/hold. Reuse the streak engine's port-mock test idiom.

### 7. `/recipes` — CRUD + import + macro materialisation

`microservices/core/src/application/recipes/`. `recipeRepository.ts`.

- `GET /recipes` → user's recipes (`WHERE user_id = ?`). `POST /recipes` — name + photo + servings + `ingredients: [{ foodId?, customName?, quantity, unit, sortOrder }]` + instructions. **Server materialises** `total_kcal`/`total_protein_g`/`total_carbs_g`/`total_fat_g` by summing ingredient `food` macros × quantity (per design.md; STORY-006 AC 6.3) — deterministic, no AI. Insert recipe + `recipe_ingredients` rows in one transaction.
- `GET/PUT/DELETE /recipes/:id` — ownership in WHERE.
- `POST /recipes/import` — body `{ url: string }`.
  - **First line: `safeRecipeFetch(body.url)`** per `design.md § Recipe-import SSRF guards`. Implement the helper at `microservices/core/src/application/recipes/services/url-fetch.ts` with EVERY guard: scheme allowlist, DNS+CIDR private-range rejection (full CIDR set incl. `169.254.0.0/16`), per-hop re-validation on ≤3 redirects, single `AbortSignal.timeout(10000)` created once outside the loop, 2 MiB streamed body cap, Content-Type allowlist (`text/html`, `application/ld+json`).
  - Parse the resulting HTML for Schema.org `Recipe` microdata / `ld+json`. Found → pre-fill shape `{ data: { name, ingredients[], instructions, servings, sourceUrl } }` (`source = 'url_import'`). **No microdata → `422 no_recipe_microdata`** (Conflict C3 — no LLM fallback in M9).
  - **Defence-in-depth (infra):** note in PR review whether `infra/` routes this Lambda's egress through a NAT/SG that blocks `169.254.0.0/16` + RFC1918. If not wired, surface it — application guards are primary, the network block is the safety net. Do NOT modify `infra/` without flagging.
  - Tests: every reject branch (`scheme_not_allowed`, each private CIDR, redirect-to-private, oversized body, timeout, disallowed Content-Type), plus a happy-path Schema.org parse + a no-microdata 422.

### 8. `/meals` — CRUD (saved presets)

`microservices/core/src/application/meals/`. `mealRepository.ts`. `GET/POST/PUT/DELETE /meals`, ownership in WHERE. `POST /meals` — name + photo + `items: [{ foodId?, recipeId?, servings, sortOrder }]`; server materialises `total_*` from the items. Insert meal + `meal_items` in one transaction.

### 9. OFF curated seed + delta-refresh cron (own PR — Brad confirmed in-scope for M9)

Goal: `foods` is pre-populated with the high-value slice of Open Food Facts so (a) common barcodes resolve locally with zero OFF live-reads, and (b) offline barcode works from launch. Read DATA_SOURCING.md § 5 first.

**9a. Seed ETL (offline/one-shot script, not a request handler).**

- Source the OFF **Parquet** dump (the simplified columnar export — do NOT scrape the API; do NOT pull the 43 GB JSONL).
- Filter (DuckDB is the documented tool) to a **curated subset**: rows with a non-null `barcode` **and** complete macros (kcal + protein + carbs + fat + serving) **and** target locales (start UK/EN; widen later). This keeps the Neon footprint to a manageable curated slice, not the full multi-GB dump.
- Map OFF `nutriments`/`code` → our `foods` columns; set `source = 'openfoodfacts'`, `created_by = NULL`. Idempotent upsert on `barcode` (re-runnable; never duplicates).
- Land as a script under `microservices/core/src/scripts/seedOpenFoodFacts.ts` (or `packages/db/scripts/`), runnable via a documented `bun` command. **Not wired into the request path.** Document the command + the filter criteria in `design.md § Data sources`.
- **ODbL:** the seeded rows are a Derivative Database — keep them tagged `source='openfoodfacts'` (segregable for the on-request ODbL offer) and ensure the FE shows OFF attribution (FRONTEND_BRIEF). Do NOT redistribute the seeded table publicly.

**9b. Delta-refresh cron (keep the seed fresh).**

- New SST `Cron` in `infra/api.ts` (sibling of `streakCron`/`volumeCron` — same `sst.aws.Cron` idiom). Daily (pick an off-peak UTC hour distinct from 02:00/03:00). Handler `microservices/core/src/offDeltaCron.ts`.
- Apply OFF **daily delta exports** (last-14-days files at `https://static.openfoodfacts.org/data/delta/`) — upsert changed products into the curated `foods` slice (respecting the same filter). Idempotent; log a `[off-delta:summary]` line like the other crons.
- Custom User-Agent on every fetch; bounded timeout; this is OFF-published static data (not the rate-limited API) but stay polite.

**9c. Tests.** Seed mapper unit tests (OFF nutriments → `foods` row; filter excludes incomplete-macro / wrong-locale rows; upsert idempotency). Delta-apply test (changed product updates the existing row, new product inserts, malformed row is skipped not fatal). Keep these fast — fixture a handful of OFF records, don't hit the network in unit tests.

**Sequencing:** depends on the migration (§ 0) existing. Independent of the endpoint work — runs as its own PR on the branch. The `POST /nutrition/barcode/resolve` cache-first lookup (§ 5) now hits a warm seeded table for common products; the live OFF fallback remains for the long tail.

## API registration (api.ts)

Register handlers in [`microservices/core/src/api.ts`](../../../microservices/core/src/api.ts) after the existing authed block. **Literal-before-`:id`** — `GET /nutrition/today`, `GET /nutrition/water/today`, `GET /nutrition/entries`, `POST /nutrition/barcode/resolve` are all literal and must precede any `/nutrition/:id`-style route (there are none planned, but keep `/foods` search before any `/foods/:id`). Add a one-line comment on the ordering, mirroring the exercises search-before-get note.

## Quality gates (from repo ROOT)

```bash
bun run prettier:check
bun run typecheck
bun run lint
bun run build
bun run test:unit        # 90% branches on changed files — non-negotiable
```

Expect +60–90 core tests over the post-M4 baseline.

## Files you will NOT touch

- Anything under `packages/mobile/` — frontend agent.
- The legacy Supabase push trigger (`supabase/migrations/010_*`, `011_*`) — the `daily_nutrition_target_hit` push delivers through it for free; do not modify.
- `microservices/core/src/application/entitlement/*` — no AI gating in M9 (Conflict C6 is M9.5's to reconcile).
- `infra/` egress/SG config — flag in PR review if the NAT/SG SSRF safety net is missing; do not change it yourself. (**Exception:** you DO add one new `sst.aws.Cron` in `infra/api.ts` for the § 9b OFF delta-refresh, mirroring the existing `streakCron`/`volumeCron` blocks — that's the only infra change in scope.)

## Inspector Brad expectations

Substantive sweep targets:

- The `GET /nutrition/today` aggregate SQL — PgDialect-rendered test guarding the 42803 GROUP-BY trap.
- Server-side macro re-derivation on `POST /entries` (don't trust client kcal when a `foodId` is referenced).
- Every SSRF reject branch on `/recipes/import` (this is the highest-risk surface — trust-boundary parity with the iOS receipt handler).
- Ownership-in-WHERE → 404 (don't leak existence) on every `:id` mutation.
- `ALTER TYPE … ADD VALUE` sequenced before the streak emit; not run inside a using-transaction.
- `numeric` → `number` boundary parsing (no string-concat macro math).
- Water mutation: absolute-`{cups}` set path exists for idempotent offline replay.

TRACE before patching. State the exact code reading + reproduction in commit messages.

## When you finish

- Tests pass, ≥90% branch coverage on touched files; all gates green.
- **Do NOT `gh pr create` or push until Brad asks** (per session rules). When told to, target `main` with the M9 reference + SMOKE_TEST link.
- Wait for Brad to fire `@inspector-brad` — do not pre-empt.
