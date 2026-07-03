# 13 — Nutrition Tracking: Design

> **Spec rewritten from scratch on 2026-05-27.** Pairs with `requirements.md`.

---

## Architecture overview

```
microservices/core/src/application/
├── nutrition/
│   ├── entries/                       ← POST /nutrition/entries, GET, PUT, DELETE
│   ├── targets/                       ← PUT /nutrition/targets, GET
│   ├── water/                         ← water log
│   ├── barcode/                       ← POST /nutrition/barcode/resolve
│   ├── ai/
│   │   ├── recognize-photo/           ← Tier B (M9.5)
│   │   ├── estimate-text/             ← Tier B
│   │   └── extract-recipe-photo/      ← Tier B
│   └── streaks/                       ← daily kcal-in-target evaluation
├── recipes/                           ← CRUD + import URL + (Tier B) snap photo
└── meals/                             ← CRUD (saved meal presets)

packages/mobile/
├── app/(app)/
│   ├── (tabs)/
│   │   └── fuel.tsx                   ← FuelContainer (replaces <ComingSoon/>)
│   └── fuel/
│       ├── targets.tsx                ← FuelTargetsContainer
│       └── recipes/
│           ├── index.tsx              ← RecipesLibraryContainer
│           ├── create.tsx             ← CreateRecipeManualContainer
│           └── import.tsx             ← ImportRecipeURLContainer
└── src/ui/
    ├── containers/
    │   ├── FuelContainer.tsx
    │   ├── FuelTargetsContainer.tsx
    │   ├── RecipesLibraryContainer.tsx
    │   ├── CreateRecipeManualContainer.tsx
    │   ├── ImportRecipeURLContainer.tsx
    │   ├── SnapRecipePhotoSheetContainer.tsx
    │   ├── ScanBarcodeSheetContainer.tsx
    │   ├── QuickAddSheetContainer.tsx
    │   ├── SnapAISheetContainer.tsx
    │   └── CreateMealFromLoggedSheetContainer.tsx
    └── presenters/
        ├── FuelPresenter.tsx
        ├── MacroHeroPresenter.tsx
        ├── QuickAddRowPresenter.tsx
        ├── MealLogPresenter.tsx
        ├── WaterTrackerPresenter.tsx
        ├── FuelTargetsPresenter.tsx
        ├── RecipesLibraryPresenter.tsx
        ├── CreateRecipeManualPresenter.tsx
        ├── ImportRecipeURLPresenter.tsx
        ├── ScanBarcodeSheetPresenter.tsx
        ├── QuickAddSheetPresenter.tsx
        ├── SnapAISheetPresenter.tsx
        ├── SnapRecipePhotoSheetPresenter.tsx
        └── CreateMealFromLoggedSheetPresenter.tsx
```

---

## Database schema (M9 Tier A migrations)

```sql
CREATE TABLE foods (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  brand           text,
  barcode         text UNIQUE,
  kcal            numeric NOT NULL,
  protein_g       numeric NOT NULL,
  carbs_g         numeric NOT NULL,
  fat_g           numeric NOT NULL,
  serving_size    numeric NOT NULL,
  serving_unit    text NOT NULL,
  source          text NOT NULL DEFAULT 'user',  -- 'user' | 'openfoodfacts' | 'ai_recognized'
  created_by      uuid REFERENCES profiles(id),
  created_at      timestamptz DEFAULT now()
);

-- Ordering matters: nutrition_entries references recipes + meals, so those must
-- exist before nutrition_entries is created. Postgres has no forward-declaration
-- for FKs at CREATE TABLE time — REFERENCES requires the target table to exist.

CREATE TABLE recipes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES profiles(id),
  name            text NOT NULL,
  photo_url       text,
  servings        numeric NOT NULL DEFAULT 1,
  instructions    text,
  source          text NOT NULL DEFAULT 'manual',  -- 'manual' | 'url_import' | 'ai_extracted'
  source_url      text,
  total_kcal      numeric,                          -- materialised from ingredients
  total_protein_g numeric,
  total_carbs_g   numeric,
  total_fat_g     numeric,
  created_at      timestamptz DEFAULT now()
);

CREATE TABLE recipe_ingredients (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id     uuid NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  food_id       uuid REFERENCES foods(id),
  custom_name   text,                                -- when not linked to a food row
  quantity      numeric NOT NULL,
  unit          text NOT NULL,
  sort_order    integer NOT NULL
);

CREATE TABLE meals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES profiles(id),
  name            text NOT NULL,
  photo_url       text,
  total_kcal      numeric NOT NULL,
  total_protein_g numeric NOT NULL,
  total_carbs_g   numeric NOT NULL,
  total_fat_g     numeric NOT NULL,
  created_at      timestamptz DEFAULT now()
);

CREATE TABLE meal_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meal_id       uuid NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
  food_id       uuid REFERENCES foods(id),
  recipe_id     uuid REFERENCES recipes(id),
  servings      numeric NOT NULL,
  sort_order    integer NOT NULL
);

CREATE TABLE nutrition_entries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES profiles(id),
  food_id           uuid REFERENCES foods(id),                    -- nullable if logging a custom one-off
  recipe_id         uuid REFERENCES recipes(id),                  -- nullable
  meal_id           uuid REFERENCES meals(id),                    -- nullable
  meal_slot         text NOT NULL CHECK (meal_slot IN ('breakfast','lunch','snack','dinner')),
  servings          numeric NOT NULL,
  kcal              numeric NOT NULL,                              -- denormalised for fast reads
  protein_g         numeric NOT NULL,
  carbs_g           numeric NOT NULL,
  fat_g             numeric NOT NULL,
  logged_at         timestamptz NOT NULL,
  logged_by_user_id uuid REFERENCES profiles(id),                 -- per cross-cuts § 1.1 — populated by M9.5+ trainer on-behalf
  ai_estimated      boolean NOT NULL DEFAULT false,
  ai_confidence     numeric                                        -- 0..1, populated when ai_estimated
);
CREATE INDEX nutrition_entries_user_date ON nutrition_entries (user_id, logged_at DESC);
CREATE INDEX nutrition_entries_user_slot_date ON nutrition_entries (user_id, meal_slot, logged_at DESC);

CREATE TABLE nutrition_targets (
  user_id           uuid PRIMARY KEY REFERENCES profiles(id),
  daily_kcal        numeric NOT NULL,
  protein_g         numeric NOT NULL,
  carbs_g           numeric NOT NULL,
  fat_g             numeric NOT NULL,
  water_cups        integer NOT NULL DEFAULT 8,
  preset            text DEFAULT 'custom',
  set_by_user_id    uuid REFERENCES profiles(id),                 -- per cross-cuts § 1.5 — trainer attribution
  updated_at        timestamptz DEFAULT now()
);

CREATE TABLE water_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES profiles(id),
  cups            integer NOT NULL,
  logged_date     date NOT NULL,
  UNIQUE (user_id, logged_date)
);

CREATE TABLE ai_usage_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES profiles(id),
  endpoint        text NOT NULL,
  request_size_bytes integer,
  response_size_bytes integer,
  ms              integer,
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX ai_usage_log_user_ts ON ai_usage_log (user_id, created_at DESC);
```

Migrations land in M9 Tier A PR. `ai_usage_log` lands with M9 even though it's used in Tier B — establishes the contract per cross-cuts § 4.2.

---

## Backend endpoints

### M9 Tier A

| Method | Path                                 | Description                                                                       |
| ------ | ------------------------------------ | --------------------------------------------------------------------------------- |
| GET    | `/nutrition/today`                   | Aggregate for Fuel screen (see § today shape below)                               |
| GET    | `/nutrition/entries?date=YYYY-MM-DD` | Day's entries                                                                     |
| POST   | `/nutrition/entries`                 | Log entry                                                                         |
| PUT    | `/nutrition/entries/:id`             | Edit entry                                                                        |
| DELETE | `/nutrition/entries/:id`             | Remove entry                                                                      |
| GET    | `/nutrition/targets`                 | Current targets                                                                   |
| PUT    | `/nutrition/targets`                 | Update targets (self)                                                             |
| GET    | `/nutrition/water/today`             | Today's water                                                                     |
| PATCH  | `/nutrition/water/today`             | Set / increment water (see § water shape below)                                   |
| POST   | `/nutrition/barcode/resolve`         | Resolve barcode → Food row (creates from Open Food Facts if not in `foods`)       |
| GET    | `/foods?query=`                      | Search foods                                                                      |
| POST   | `/foods`                             | User creates a custom food                                                        |
| GET    | `/recipes`                           | User's recipes                                                                    |
| POST   | `/recipes`                           | Create recipe (manual)                                                            |
| POST   | `/recipes/import`                    | Import from URL (server scrapes — SSRF-hardened, see § Recipe-import SSRF guards) |
| GET    | `/recipes/:id`, `PUT`, `DELETE`      | CRUD                                                                              |
| GET    | `/meals`, `POST`, `PUT`, `DELETE`    | CRUD                                                                              |

#### Endpoint contracts (M9 Tier A)

All responses envelope the payload under `{ data: … }`. `userId` is always the
JWT subject (`getUser(ctx).sub`), never the body. All `numeric` macro columns are
parsed to JS `number` at the repository boundary (Drizzle returns `numeric` as
`string`); the wire shape is numeric.

`Food`, `NutritionEntry`, `NutritionTarget`, `Recipe`, `Meal` are the Drizzle
row shapes with macro columns coerced to `number`.

- **`GET /nutrition/today?date=YYYY-MM-DD`** (default = server today) →

  ```ts
  { data: {
      date: string;                 // YYYY-MM-DD
      targets: NutritionTarget | null;
      consumed: { kcal: number; protein_g: number; carbs_g: number; fat_g: number; water_cups: number };
      remainingKcal: number;        // targets.daily_kcal - consumed.kcal (0 if no target)
      entriesBySlot: { breakfast: NutritionEntry[]; lunch: NutritionEntry[]; snack: NutritionEntry[]; dinner: NutritionEntry[] };
  } }
  ```

  `consumed` is a SUM aggregate over `nutrition_entries (user_id, logged_at::date)`
  — the GROUP-BY-risk query; rendered through `PgDialect` in a test to guard the
  Postgres 42803 trap (per `reference_drizzle_groupby_param_bug`). Empty day →
  all-zero `consumed`, four empty slot arrays.

- **`GET /nutrition/entries?date=YYYY-MM-DD`** → `{ data: NutritionEntry[] }`, `logged_at DESC`.
- **`POST /nutrition/entries`** body `{ foodId?, recipeId?, mealId?, mealSlot, servings, kcal, protein_g, carbs_g, fat_g, loggedAt }` → `201 { data: NutritionEntry }`. When `foodId`/`recipeId`/`mealId` is present the server **re-derives** the macros from the referenced row × servings (client kcal is not trusted); a true one-off (no reference) accepts the client macros. `logged_by_user_id` = NULL (self-write).
- **`PUT /nutrition/entries/:id`** edit servings/slot/macros — ownership folded into WHERE; no row → 404.
- **`DELETE /nutrition/entries/:id`** — ownership in WHERE; no row → 404.
- **`GET /nutrition/targets`** → `{ data: NutritionTarget | null }`. When `set_by_user_id IS NOT NULL`, includes the setter's `profiles.display_name` as `setByName` for the FE banner (cross-cuts § 1.5).
- **`PUT /nutrition/targets`** body `{ dailyKcal, proteinG, carbsG, fatG, waterCups, preset }` — upsert on `user_id` (PK). Self-write only: `set_by_user_id` stays untouched (NULL on first self-set; the M8 trainer route is the only writer of a non-null value). → `{ data: NutritionTarget }`.
- **`GET /nutrition/water/today?date=YYYY-MM-DD`** → `{ data: { cups: number; goal: number } }` (`goal` from `nutrition_targets.water_cups`, default 8).
- **`PATCH /nutrition/water/today`** body `{ cups: number }` (authoritative absolute set — used by the offline sync-flush path; last-write-wins) **or** `{ delta: 1 | -1 }` (convenience). Upsert on `(user_id, logged_date)`; clamp `cups >= 0`. → `{ data: { cups: number; goal: number } }`.
- **`POST /nutrition/barcode/resolve`** body `{ code }` → `{ data: Food }`. Cache-first against `foods.barcode`; miss → Open Food Facts fetch (custom User-Agent, 8s timeout, 429 backoff + circuit-breaker) → insert + return; OFF 404/no-product → `404 barcode_not_found`. See § Data sources.
- **`GET /foods?query=`** → `{ data: Food[] }`, `name ILIKE %query%` + the caller's own `source='user'` rows, limit 50.
- **`POST /foods`** body `{ name, brand?, kcal, proteinG, carbsG, fatG, servingSize, servingUnit, barcode? }` → `201 { data: Food }` (`source='user'`, `created_by = userId`).
- **`GET /recipes`** → `{ data: Recipe[] }` (`WHERE user_id = ?`). **`POST /recipes`** body `{ name, photoUrl?, servings, instructions?, ingredients: [{ foodId?, customName?, quantity, unit, sortOrder }] }` → `201 { data: Recipe }`; server materialises `total_*` from ingredient `food` macros × quantity in one transaction.
- **`GET/PUT/DELETE /recipes/:id`** — ownership in WHERE; no row → 404.
- **`POST /recipes/import`** body `{ url }` → `{ data: { name, ingredients[], instructions, servings, sourceUrl } }`. First line is `safeRecipeFetch(url)` (every SSRF guard below); deterministic Schema.org / `ld+json` scrape only. No `Recipe` microdata → `422 no_recipe_microdata` (Conflict C3 — no LLM fallback in M9).
- **`GET/POST/PUT/DELETE /meals`** — ownership in WHERE. `POST /meals` body `{ name, photoUrl?, items: [{ foodId?, recipeId?, servings, sortOrder }] }` → `201 { data: Meal }`; server materialises `total_*` from items in one transaction.

### M9.5 Tier B — **deferred to M9.5** (all gate on `aiAccess` via `assertEntitlement` per cross-cuts § 4.1)

| Method | Path                            | Description                         | Status               |
| ------ | ------------------------------- | ----------------------------------- | -------------------- |
| POST   | `/nutrition/ai/recognize-photo` | Multipart photo → recognised items  | **deferred to M9.5** |
| POST   | `/nutrition/ai/estimate-text`   | Free-text → macro estimate          | **deferred to M9.5** |
| POST   | `/recipes/ai/extract-photo`     | OCR + LLM extract structured recipe | **deferred to M9.5** |

All AI endpoints (M9.5):

1. First line: `await assertEntitlement(ctx.userId, 'aiAccess')`. On denial → 402 + `ENTITLEMENT_DENIED` payload per cross-cuts § 4.1.
2. Log to `ai_usage_log` per § 4.2.
3. Return structured response.

---

## Data sources (M9 Tier A — Open Food Facts)

Outcome of `specs/milestones/M9-nutrition/DATA_SOURCING.md`. The M9 food database is **Open Food Facts (OFF)**:

- **Free, no API key** for reads. Writes need an account (we don't write).
- **ODbL licence — attribution required.** The OFF-derived `foods` rows are a Derivative Database; serving lookups to users is a "Produced Work" (attribution only, no share-alike on our app/user data). Practical posture: tag OFF rows `source='openfoodfacts'` (segregable for the on-request ODbL offer); the FE must credit Open Food Facts (food-detail sheet + an About/Data-sources line). The BE returns `source` on every `Food` so the FE knows when to show the credit. Do not bulk-redistribute the seeded table publicly.
- **Rate limit: 15 product reads / min / IP.** Our Lambda concentrates all users' scans on one egress IP, so naive live proxying gets us IP-banned at scale. **Cache-first against `foods` is load-bearing, not an optimisation** — only true misses hit OFF. The live path also has exponential 429 backoff + a circuit-breaker that returns `barcode_not_found` (graceful — user adds manually) rather than retrying into a ban. No unbounded retry loop.
- **Mandatory custom User-Agent** on every OFF request: `Persistence/<appVersion> (<contact-email>)` — pulled from config (`OFF_USER_AGENT`, public, not a secret), never hard-coded. Missing/generic UA → throttled or banned.
- **OFF is an external network hop but NOT a user-controlled URL** (the barcode is the only input; the host is fixed `world.openfoodfacts.org`), so it does **not** need the full SSRF guard — just timeout + size cap + error handling. The SSRF guard is for `/recipes/import` only.

### Bulk seed (OFF Parquet → curated `foods` subset) + delta-refresh cron — in scope for M9

Brad confirmed 2026-06-21 (DATA_SOURCING.md § 5, option 2). So offline barcode works at launch and the live rate-limit is a non-issue, `foods` is pre-populated with a curated OFF slice:

- **Seed ETL** (`microservices/core/src/scripts/seedOpenFoodFacts.ts`, runnable via a documented `bun` command — **not** wired into the request path). Source the OFF **Parquet** dump (not the 43 GB JSONL, not the live API). Filter to a curated subset: rows with a non-null `barcode` **and** complete macros (kcal + protein + carbs + fat + serving) **and** target locales (start UK/EN). Map OFF `nutriments`/`code` → `foods` columns; `source='openfoodfacts'`, `created_by=NULL`. Idempotent upsert on `barcode`. DuckDB is the documented filter tool for the Parquet step (operational; the script consumes already-filtered records / a curated NDJSON the operator produces).
- **Delta-refresh cron** (`microservices/core/src/offDeltaCron.ts`, new `sst.aws.Cron` in `infra/api.ts`, daily off-peak UTC). Applies OFF **daily delta exports** (last-14-days files at `https://static.openfoodfacts.org/data/delta/`), upserting changed products into the curated slice (same filter). Idempotent; logs `[off-delta:summary]`. Custom User-Agent on every fetch; bounded timeout. This is OFF-published static data (not the rate-limited API) but stays polite.

**USDA FoodData Central** (public domain — no ODbL) is a complementary source for generic/whole foods on the search path; optional for M9 (the base `/foods` search hits our own table). Not seeded in M9.

### Offline behaviour — water mutation contract

Because water increments aren't idempotent on replay, the FRONTEND_BRIEF queues an **absolute `{ cups }`** value (last-write-wins), not a delta. `PATCH /nutrition/water/today` accepts both `{ cups }` (the authoritative set used by the sync flush) and `{ delta }` (a convenience the FE may avoid in favour of optimistic-local-then-set).

---

## Recipe-import SSRF guards

`POST /recipes/import` accepts a user-supplied URL and has the Lambda fetch it server-side. Naive `fetch(body.url)` ships an open SSRF vector — Lambda VPC connectivity reaches AWS instance metadata, internal-VPC services, and link-local addresses; an attacker submits `http://169.254.169.254/latest/meta-data/iam/security-credentials/<role>` and the response returns IAM role credentials. Trust boundary same shape as the iOS receipt handler (§ `12-production-readiness`) — the URL is user-controlled input that drives a network hop, so every guard must be explicit, not assumed.

**Required guards** (every one must be present; failing any returns 400):

1. **Scheme allowlist** — accept only `http:` and `https:`. Reject `file:`, `gopher:`, `data:`, `ftp:`, `dict:`, anything else.

2. **DNS resolution + private-range rejection** — before any network hop, resolve the hostname to its A and AAAA records. Reject if ANY resolved address falls in any of:
   - IPv4 RFC1918: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
   - IPv4 loopback: `127.0.0.0/8`
   - IPv4 link-local: `169.254.0.0/16` (covers AWS instance metadata `169.254.169.254`)
   - IPv4 reserved: `0.0.0.0/8`, `100.64.0.0/10` (CGNAT), `192.0.0.0/24`, `192.0.2.0/24`, `198.18.0.0/15`, `198.51.100.0/24`, `203.0.113.0/24`, `224.0.0.0/4`, `240.0.0.0/4`
   - IPv6 loopback: `::1/128`
   - IPv6 link-local: `fe80::/10`
   - IPv6 ULA: `fc00::/7`
   - IPv6 mapped-IPv4: `::ffff:0:0/96` (re-evaluate the embedded IPv4 against the rules above)

3. **Redirect handling** — follow at most 3 redirects. **Re-run the DNS + IP check on every hop** — an attacker can host `https://attacker.com/recipe` that returns `302 Location: http://169.254.169.254/...`. The fetch library's default redirect handling does NOT re-check the destination; this MUST be implemented as a manual loop (`fetch` with `redirect: 'manual'`, follow the `Location` header explicitly, re-validate, re-fetch).

4. **Response caps** — a single `AbortSignal.timeout(10000)` created ONCE outside the redirect loop (10s wall-clock across all hops + DNS + body streaming — NOT per-hop, or three slow redirects = ~40s past the API Gateway 29s ceiling), max response body 2 MiB (stream + abort on overrun). Recipes are HTML pages, not multi-MB binaries.

5. **Content-Type allowlist** — accept only `text/html` and `application/ld+json` (Schema.org microdata). Reject everything else — no need to parse `application/octet-stream` or `text/plain` for recipe scraping.

6. **Outbound proxy / network ACL (defence-in-depth at infra layer)** — the SST stack should route this Lambda's outbound traffic through a NAT gateway with an explicit egress allowlist OR a security-group rule that blocks `169.254.0.0/16` + RFC1918 destinations at the network layer. Belt-and-braces — application guards 1–5 are primary, the network-layer block is the safety net for any future code-path that forgets to call the validator.

Helper shape:

```ts
// microservices/core/src/application/recipes/services/url-fetch.ts
const ALLOWED_SCHEMES = new Set(["http:", "https:"]);
const ALLOWED_CONTENT_TYPES = ["text/html", "application/ld+json"];
const MAX_REDIRECTS = 3;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 10_000;

export async function safeRecipeFetch(
  rawUrl: string,
): Promise<{ html: string; finalUrl: string }> {
  let currentUrl = new URL(rawUrl); // throws on malformed input → caller 400s
  if (!ALLOWED_SCHEMES.has(currentUrl.protocol)) {
    throw new BadRequestError("scheme_not_allowed");
  }

  // ONE budget for the whole fetch path — created outside the loop. A per-hop
  // AbortSignal.timeout would give each of up to MAX_REDIRECTS+1 hops a fresh
  // 10s, letting a slow-loris chain hold the Lambda for ~40s + untimed DNS +
  // body streaming — past the 29s API Gateway ceiling. The single deadline
  // caps total wall-clock (fetch + redirect hops) at TIMEOUT_MS.
  const deadline = AbortSignal.timeout(TIMEOUT_MS);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertHostnameIsPublic(currentUrl.hostname); // throws on private-range hit
    const res = await fetch(currentUrl, {
      redirect: "manual",
      signal: deadline,
      headers: { Accept: ALLOWED_CONTENT_TYPES.join(", ") },
    });

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new BadRequestError("redirect_without_location");
      currentUrl = new URL(loc, currentUrl); // resolve relative redirects
      if (!ALLOWED_SCHEMES.has(currentUrl.protocol)) {
        throw new BadRequestError("scheme_not_allowed_after_redirect");
      }
      continue;
    }

    if (!res.ok) throw new BadRequestError("upstream_status_" + res.status);

    const ct = res.headers.get("content-type")?.split(";")[0].trim();
    if (!ct || !ALLOWED_CONTENT_TYPES.includes(ct)) {
      throw new BadRequestError("content_type_not_allowed");
    }

    // Streamed read with byte cap — fail on overrun instead of buffering full body.
    const html = await readCapped(res.body, MAX_BODY_BYTES);
    return { html, finalUrl: currentUrl.toString() };
  }
  throw new BadRequestError("too_many_redirects");
}

async function assertHostnameIsPublic(hostname: string): Promise<void> {
  const addrs = await dns.promises.lookup(hostname, { all: true });
  for (const { address, family } of addrs) {
    if (isPrivateIp(address, family)) {
      throw new BadRequestError("hostname_resolves_to_private_address");
    }
  }
}
```

`isPrivateIp(address, family)` covers the CIDR set listed in guard #2. `readCapped(stream, n)` is a streamed reader that aborts the response when the running byte count exceeds `n`.

The handler at `application/recipes/handlers/import.ts` calls `safeRecipeFetch(body.url)` as the first step (before any parsing); the existing recipe-extraction logic operates on the resulting `html` only. Tests cover every reject branch (`scheme_not_allowed`, every private CIDR, redirect-to-private, oversized body, timeout, disallowed Content-Type).

### Import-URL tier (Conflict C3) — deterministic scrape only in M9

M9 ships a **deterministic Schema.org / `ld+json` `Recipe` scrape only**. The
parser reads structured recipe data from the fetched HTML (`<script type="application/ld+json">`
graphs + Schema.org microdata). On a successful parse it pre-fills
`{ data: { name, ingredients[], instructions, servings, sourceUrl } }`
(`source='url_import'`). **A page with no `Recipe` microdata → `422 no_recipe_microdata`**;
the FE renders a graceful "couldn't read this page" state. The LLM fallback
for non-Schema.org sites (and the prototype's "AI" pill) **defer to M9.5** — the
M9 import is NOT AI. (See the Risks table note, superseded for M9: no
`source='ai_extracted'` path ships in M9.)

**TOCTOU note**: a sophisticated DNS-rebinding attack can change the A record between `assertHostnameIsPublic` and the `fetch`. The standard mitigation is to resolve once + fetch by IP literal + set `Host` header to the original hostname — but `fetch` in Node doesn't expose that cleanly, and the realistic threat model (DNS-rebinding requires attacker-controlled DNS with short TTL + the Lambda VPC re-resolving) is marginal vs the cost of a custom socket layer. M9 ships with the resolve-then-fetch pattern; if DNS-rebinding gets exploited the follow-up is a `fetch-by-resolved-IP` patch.

---

## Frontend — `<FuelPresenter>`

Per `nutrition.jsx`.

```ts
type FuelProps = {
  date: Date;
  targets: NutritionTarget;
  consumed: { kcal: number; protein_g: number; carbs_g: number; fat_g: number };
  remainingKcal: number;
  entriesBySlot: Record<MealSlot, NutritionEntry[]>;
  waterCups: number;
  waterGoal: number;
  aiEntitled: boolean;
  onOpenTargets: () => void;
  onOpenScan: () => void;
  onOpenSnap: () => void;
  onOpenRecipes: () => void;
  onOpenQuickAdd: (mealSlot: MealSlot) => void;
  onIncrementWater: () => void;
  onDecrementWater: () => void;
};
```

Sub-presenters: `<MacroHeroPresenter>` (Ring + macro lines + consumed/target stat), `<QuickAddRowPresenter>` (3-button strip; Snap btn shows lock icon when `!aiEntitled`), `<MealLogPresenter>` (4 sections), `<WaterTrackerPresenter>` (cups grid with tap to +/-).

---

## Frontend — sheets

Each sheet is a `<BottomSheet>` from `01-design-system`. Common shape:

```ts
type SheetProps = {
  visible: boolean;
  onClose: () => void;
  onSave: (input: …) => Promise<void>;
};
```

### `<ScanBarcodeSheetPresenter>`

Per `fuel-sheets.jsx` (Scan section). Camera view + scanning-line animation (Reanimated `withRepeat(withTiming(translateY, 1500))`). On barcode detected, resolves via `useResolveBarcode(code)` + shows food card with serving/meal selector + Add Btn.

### `<SnapAISheetPresenter>` (Tier B)

Per `fuel-sheets.jsx` (Snap section). Camera capture button + recognising animation ("Recognizing…" with pulsing sparkles). On capture, uploads to `/nutrition/ai/recognize-photo`. Receives recognised items → editable list → Add. If `!aiEntitled`, sheet immediately shows upgrade prompt instead.

### `<QuickAddSheetPresenter>`

Per `fuel-sheets.jsx` (Quick add section). Tabs (Search / Recents / Meals / Recipes) → results list → tap to select → serving size + meal slot inputs → Add Btn. Optional "Or describe it…" CTA at the bottom for Tier B text-estimation flow.

---

## Frontend — Fuel Targets screen

Per `fuel-targets.jsx`.

```ts
type FuelTargetsProps = {
  current: NutritionTarget;
  setByCoach?: { coachName: string };
  onPresetSelect: (preset: "Maintain" | "Cut" | "Bulk" | "Custom") => void;
  onChangeKcal: (kcal: number) => void;
  onChangeMacroSplit: (
    proteinPct: number,
    carbsPct: number,
    fatPct: number,
  ) => void;
  onChangeWaterGoal: (cups: number) => void;
  onSave: () => Promise<void>;
};
```

Layout: header + preset chips + calorie input + macro split sliders + water cups stepper + Save CTA. If `setByCoach` is set: trainer-attribution banner at the top (per cross-cuts § 1.5).

---

## Frontend — Recipes library + create flows

`<RecipesLibraryPresenter>` per `recipes.jsx RecipesScreen`. `<Segmented>` Meals / Recipes. Each tab: list of cards + + Create dropdown.

`<CreateRecipeManualPresenter>` per `recipes.jsx CreateRecipeManual` — name + photo + servings + ingredient rows + instructions textarea + Save.

`<ImportRecipeURLPresenter>` per `recipes.jsx ImportFromURL` — URL input → fetch → pre-fill manual form.

`<SnapRecipePhotoSheetPresenter>` (Tier B) per `recipes.jsx SnapRecipePhoto` — same camera + AI gating as nutrition Snap.

---

## Streak engine integration

Per `_shared/cross-cuts.md § 3.1`, `nutrition_streak` is daily. Period satisfied when daily total kcal falls within target ± 10%.

Backend hook: end-of-day cron at 02:00 UTC (sibling of `06-progress-goals § Streak cron` — the same `streakCron` handler). For each user with a `nutrition_streak` row + a `nutrition_targets` row, compute the prior user-local day's kcal total (`profiles.timezone`, default `Europe/London`) + check against `nutrition_targets.daily_kcal`. Within ±10% → period satisfied → **advance** (`+1`, mint freeze tokens, unlock milestones, fire `streak_milestone`). Outside → the existing freeze-token check (per § 3.5) or break.

Unlike workout/habit/measurement streaks (which the on-write engine advances), nutrition's **advance also lives in the cron**: the daily kcal total is volatile until the day ends, so `isPeriodSatisfied` for `nutrition_streak` evaluates `SUM(kcal)` over `nutrition_entries` for the user-local day window vs `daily_kcal ± 10%`. The cron evaluates the most-recently-completed day, advances if satisfied, then runs the standard miss/freeze/break sweep.

On a satisfied day the cron also emits a `daily_nutrition_target_hit` notification **only if the user's `notification_preferences` opt-in is on** (default **off** per cross-cuts § 5 — effectively opt-in). The `ALTER TYPE … ADD VALUE 'daily_nutrition_target_hit'` migration MUST be applied (own statement, not in a using-transaction) before this emit, or the first `INSERT INTO notifications` 500s with `invalid input value for enum`.

Real-time evaluation on `POST /nutrition/entries`: skip the **durable** streak advance — the daily total is volatile until the day ends (more logging can push an in-range day to over), so a server-side advance can't commit until day-close without risking a retract. Cron owns the durable count + miss-sweep.

### Immediate in-app reward (instant — decoupled from the durable streak)

> **Revised 2026-06-23 (Brad):** The durable streak waits for day-close, but the _reward_ must not — a 2am-next-day acknowledgement demotivates. The two are separate concerns.

The Fuel screen already has `consumed` + `targets` + `remainingKcal` from `GET /nutrition/today`, so the **client** detects, the instant a logged entry brings the day's total into `daily_kcal ± 10%` (and likewise per-macro), and fires an **immediate optimistic celebration** ("Calorie goal hit") + marks today's ring as _hit_. This is purely reactive on the mobile side — no server round-trip beyond the log itself, no new endpoint. If subsequent logging pushes the day back out of range, the optimistic mark clears.

- **Immediate layer (frontend, optimistic):** crossing into ±10% → in-app celebration + today marked hit. Zero delay. Self-corrects if the day later goes out of range. See `FRONTEND_BRIEF § Immediate goal-hit reward`.
- **Durable layer (backend cron, authoritative):** confirms the day _closed_ in range → advances `nutrition_streak`, mints tokens, unlocks milestones. The `daily_nutrition_target_hit` **push** stays here (end-of-day) so it never claims a goal-hit the user later blew past.

This mirrors MyFitnessPal / MacroFactor: instant "goal reached" feedback, persistent streak as the day-close record.

---

## AI entitlement gating

All Tier B endpoints + AI sheets gate on `aiAccess`:

```tsx
// Frontend: in containers/SnapAISheetContainer.tsx
const entitlement = useEntitlement("aiAccess");

if (!entitlement.granted) {
  return (
    <AiUpgradePromptSheet
      onClose={onClose}
      reason={entitlement.message}
      upgradeUrl={entitlement.upgradeUrl}
    />
  );
}
```

```ts
// Backend: every Tier B handler's first line
await assertEntitlement(ctx.userId, "aiAccess");
```

Failure → 402 + `{ code: 'ENTITLEMENT_DENIED', entitlement: 'aiAccess', message, upgradeUrl }` per cross-cuts § 4.1.

---

## Offline behaviour

| Action                                   | Behaviour                                                                                                       |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Log entry (manual / barcode / Quick add) | Queue + optimistic. UI shows entry; macros recalc client-side; sync flushes on reconnect.                       |
| Edit / delete entry                      | Queue + optimistic.                                                                                             |
| Water log                                | Queue + optimistic.                                                                                             |
| Set targets                              | Queue + optimistic.                                                                                             |
| Create recipe / meal                     | Queue + optimistic.                                                                                             |
| Barcode resolve (offline)                | Falls back to cached `foods` table; if not present, shows "Food not in cache — connect to fetch from database." |
| AI photo recognise                       | Requires online — sheet shows "Connect to internet to use AI features."                                         |
| AI text estimate                         | Same.                                                                                                           |

---

## Notification triggers

Per cross-cuts § 5:

| Trigger                         | Event                             | Enum status                                     | Default opt-in                        |
| ------------------------------- | --------------------------------- | ----------------------------------------------- | ------------------------------------- |
| Daily nutrition target hit      | `daily_nutrition_target_hit`      | **NEW — needs ALTER TYPE**                      | **off** (noisy)                       |
| Nutrition target set by trainer | `nutrition_target_set_by_trainer` | Owned by `10-trainer-features` ALTER TYPE block | on (emitted by `10-trainer-features`) |

**Enum-extension requirement (per cross-cuts § 5 + `09-notifications-social § Backend — enum-extension contract`).** `daily_nutrition_target_hit` is NOT in the live `notification_type` enum at `packages/db/src/schema.ts:139`. The first M9 backend PR that emits it MUST coordinate a companion migration owned by `09-notifications-social`:

```sql
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'daily_nutrition_target_hit';
```

Without this migration sequenced BEFORE the nightly target-hit cron ships, the first `INSERT INTO notifications` for this type fails at runtime with `invalid input value for enum notification_type`. Per the cross-cuts § 5 procedure, the same PR also appends the new type to the cross-cuts taxonomy table (already done in PR #76) + extends `09-notifications-social/design.md § Frontend — domain models` `NotificationType` union (already done).

`nutrition_target_set_by_trainer` is emitted by `10-trainer-features` and that spec owns its `ALTER TYPE` line; this spec just relies on the value existing by the time M8 ships.

M7 owns delivery.

---

## Testing strategy

### Unit tests

- All endpoint handlers — happy paths + 4xx + 5xx.
- `assertEntitlement('aiAccess')` integration with M10.5 helper.
- Streak engine integration: feed kcal totals, assert engine advances or holds.
- Recipe scraper unit tests (Schema.org microformat parsing).

### Integration tests

- E2E: log breakfast offline → kcal counter updates → reconnect → assert sync + ring redraw.
- E2E: barcode scan offline (cached barcode) → success. Barcode scan offline (uncached) → graceful error.
- E2E (Tier B): AI photo without aiAccess → upgrade prompt. With aiAccess → recognise → items → add.
- Streak: log a day exactly in-target → streak advances. Off-target → no advance.

### Coverage

90% per `_agent.md`.

---

## Risks + mitigations

| Risk                                                                                                                                                                    | Mitigation                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Open Food Facts barcode DB has gaps                                                                                                                                     | Allow user-created `foods` row when barcode not found; user fills macros manually. Source = 'user'.                                                                                                                                                                                                                                                                        |
| Barcode scanner perf on Android                                                                                                                                         | Use `react-native-vision-camera-v3-barcode-scanner`. Validate during sheet PR.                                                                                                                                                                                                                                                                                             |
| LLM cost spikes on high-volume Tier B users                                                                                                                             | `ai_usage_log` writes per call; future quota tier can throttle without schema change.                                                                                                                                                                                                                                                                                      |
| Recipe URL scraper breaks on non-Schema.org sites                                                                                                                       | Fall back to LLM-based extraction with user confirmation step. Mark as `source = 'ai_extracted'`.                                                                                                                                                                                                                                                                          |
| **SSRF via user-supplied recipe-import URL** (Lambda fetches `http://169.254.169.254/...` → IAM role creds; internal-VPC services reachable; redirect-to-private space) | Hardened per § "Recipe-import SSRF guards": scheme allowlist, DNS+CIDR rejection covering RFC1918 / loopback / link-local / IPv6 ULA, per-hop re-validation on redirects, 10s timeout + 2 MiB body cap, Content-Type allowlist, network-layer egress block as defence-in-depth. Trust-boundary treatment parity with the iOS receipt handler in `12-production-readiness`. |
| Macro target ± 10% tolerance for streak may be too tight / too loose                                                                                                    | Hardcoded in v1; revisit based on user data. Tolerance editable per-user as v2 if needed.                                                                                                                                                                                                                                                                                  |
| `nutrition_targets.set_by_user_id` cross-cut with `10-trainer-features` requires both specs to agree on the column shape                                                | Locked in cross-cuts § 1.5 + § 2.1 patterns. Migration block owned by THIS spec (M9 ships the column at table creation).                                                                                                                                                                                                                                                   |
| Macro autobalance UX in Fuel Targets — sliders that auto-rebalance can confuse users                                                                                    | Use 3-input pattern (% for each macro) + warning chip when sum ≠ 100; not auto-adjust.                                                                                                                                                                                                                                                                                     |

---

_End of `13-nutrition-tracking/design.md` · 2026-05-27 (rewritten from scratch)_

---

## Revised 2026-07-03 — M9.5 Tier B design (photo + free-text estimation, launch scope)

Supersedes the "M9.5 Tier B — deferred" endpoint table above. STORY-013 (`POST /recipes/ai/extract-photo`) remains deferred and is unchanged.

### Provider architecture — Claude on AWS Bedrock, IAM auth

- **No API-key secret.** The core Lambda gets an IAM policy allowing `bedrock:InvokeModel` (+ `InvokeModelWithResponseStream` unused-but-harmless omitted) on the two inference-profile ARNs, granted in `infra/api.ts` via the function's `permissions`. This kills the whole secret-rotation/leak class for a public repo — nothing to set in CI, nothing in the SST secret store.
- **SDK**: `@anthropic-ai/bedrock-sdk` (`AnthropicBedrock` client) — identical Messages request/response shape to the direct Anthropic API; auth is SigV4 from the Lambda role.
- **Models** (deploy-time env config `AI_PHOTO_MODEL_ID` / `AI_TEXT_MODEL_ID`, defaults):
  - Photo: `eu.anthropic.claude-opus-4-6-v1` (EU cross-region inference profile; invocable from eu-west-2). Opus 4.8/4.7 are account-gated on Bedrock — revisit if access is granted; same price class.
  - Free-text: `eu.anthropic.claude-haiku-4-5-20251001-v1:0`.
- **Structured output = forced tool use**: one tool (`report_estimate`) whose `input_schema` is the estimate schema, `tool_choice: { type: 'tool', name: 'report_estimate' }`. Chosen over `output_config.format` because structured-outputs support is fragmented across Bedrock endpoints/models (the Bedrock Messages path rejects it outright), while tool-forcing works on every Claude model on every rail — and ports to non-Anthropic Bedrock models via Converse if ever needed.
- **Adapter seam**: `application/nutrition/services/aiEstimation.ts` exposes
  `estimateFromPhoto({ imageBase64, mediaType, mealType? }): Promise<AiEstimate>` and `estimateFromText({ description }): Promise<AiEstimate>`
  where `AiEstimate = { foods: AiFoodItem[], overallConfidence, notes }`, `AiFoodItem = { name, quantity, unit, estimatedGrams, kcal, proteinG, carbsG, fatG, confidence }`.
  The Bedrock client is injectable (same pattern as `openFoodFacts.ts`'s injectable fetcher) — unit tests never make live calls; CI needs no AWS credentials. Client timeout 25s, `max_tokens` 1500, one retry on 5xx/timeout inside the 120s Lambda budget. Model refusal / missing tool_use block / schema-invalid input → `AiUnreadableError`.

### Endpoints

| Method | Path                          | Body                                                                                 | Model     |
| ------ | ----------------------------- | ------------------------------------------------------------------------------------ | --------- |
| POST   | `/nutrition/ai/estimate`      | `{ imageBase64: string, mediaType: 'image/jpeg'\|'image/png', mealType?: MealType }` | opus-4-6  |
| POST   | `/nutrition/ai/estimate-text` | `{ description: string (1–1000 chars) }`                                             | haiku-4-5 |

Handler order (both): `requireAuth` → `assertEntitlement(userId, 'ai_access')` (402 `ENTITLEMENT_DENIED`/`aiAccess` on deny) → [abuse ceiling: >30 `ai_usage_log` rows today → 429 `AI_DAILY_LIMIT` — pending Brad] → validate body → adapter call → `200 { data: AiEstimate }`. `ai_usage_log` insert happens in a `finally` (endpoint, request/response byte sizes, ms) — written on success AND failure.

Errors: `413 image_too_large` (base64 > 5 MB), `422 ai_unreadable` (refusal/unparseable), `503 ai_unavailable` (provider outage/timeout after retry). Mobile maps 422/503 to the "Couldn't read this photo — try Quick Add instead" state.

**Image transport — base64-in-JSON, not multipart.** Client downscales to ≤1080px long edge + JPEG ~0.7 quality via `expo-image-manipulator` (already a dependency) → typically 150–400 KB → ~200–530 KB as base64, far under the 6 MB Lambda payload cap. One code path through the existing Elysia `t.Object` validation and the mobile `SSTApiAdapter` JSON client; no multipart parser; the image is transient — decoded, size- and magic-byte-checked (JPEG/PNG), sent to Bedrock, never persisted.

**Entitlement (closes C6):** `EntitlementFeature` gains `'ai_access'`; `assertEntitlement` implements the real check (latest sub + tier join → `subscription_tiers.ai_access`; deny reasons mirror `create_workout`'s cancelled/expired handling). `ai_workout` stub untouched. Wire payload string stays `aiAccess`.

**No automated foods-table grounding (eval-locked).** Grounding worsened every model's accuracy (junk rows + wrong-nutriment products in the OFF seed). Draft card carries the model's own numbers; the user can swap any item for a DB food manually. Revisit only after a foods-table quality pass (name-length filter, kcal sanity bounds, trigram search) — captured as a future task, not v1.

### Mobile flow (SnapAISheet)

State machine per `fuel-sheets.jsx SnapSheet`: `capture` (camera via expo-camera + photo-library pick) → local downscale/compress → `recognizing` (pulsing sparkles) → `confirm` (AI summary card: dish name + total kcal; toggleable item rows with name/amount/kcal/confidence %, confidence < 0.7 default-unticked; serving edits recompute totals) → confirm → one `POST /nutrition/entries` per kept item (customName + macros payload, existing manual path) → `added` affirmation. Root-mounted sheet, zustand open-state, 86% height, gold accent.
Offline: Snap button disabled + copy "Snap needs a connection — try Quick Add instead"; AI calls never queue.
Free-text: "Or describe it…" in QuickAddSheet → text input → same recognizing/confirm flow via `estimate-text`.
Permissions: widen the `expo-camera` plugin `cameraPermission` string (currently barcode-only) and `expo-image-picker` strings to cover meal photos; both plugins write `NSCameraUsageDescription` — verify the merged value at prebuild. Native string change ⇒ new EAS dev build.

### Cost model (Brad's constraint: AI spend must not balloon vs subscription)

EU Bedrock pricing (list + 10% regional): opus-4-6 $5.50/$27.50 per MTok, haiku $1.10/$5.50. Measured per snap: ~1,650 input + ~250–500 output tokens → **~$0.019/snap (≈1.5p)**; free-text ~$0.002. Heavy user (5 snaps/day) ≈ £2.20/mo vs £12.99 premium (~17%); typical 1–2/day ≈ £0.45–0.90 (3.5–7%). The 30/day ceiling caps worst-case at ~£13/mo. `ai_usage_log` gives per-user cost telemetry from day one; a future quota tier can throttle without schema change.

### Test plan (M9.5 additions)

Backend: handler tests — 402 (free tier), [429 at ceiling], 413 oversize, 422 refusal, 503 outage, happy path (mocked adapter), usage-log written on success + failure; adapter tests — tool-forcing request shape, image block shape, timeout/retry, refusal mapping; entitlement tests — `ai_access` allow (premium active/trialing) / deny (free, cancelled+expired reasons). No live API calls anywhere in CI.
Mobile: gate branch (locked → upgrade prompt), capture→recognizing→confirm state machine, low-confidence default-untick, toggle/edit recompute, confirm posts N entries, offline disabled affordance, 422/503 error state + retry.
