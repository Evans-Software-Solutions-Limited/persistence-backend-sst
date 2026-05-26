# 13 — Nutrition Tracking: Technical Design

## 1. Overview & tier split

The Nutrition feature is a **net-new full-stack build**. There is no legacy mobile counterpart and no existing nutrition surface in the schema — a 2026-05-26 audit of `packages/db/src/schema.ts` confirms zero nutrition tables. The feature ships in two milestones sharing this spec folder:

| Tier  | Milestone | Surface                                                                                                                                                                         | Ship status     |
| ----- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| **A** | M9        | Manual food entry + barcode (Open Food Facts) + portion-confirm cards + daily ring + macro bars + water tracker + meal templates + offline-first sync + Apple Health write-back | Net-new in M9   |
| **B** | M9.5      | AI photo recognition (Claude Vision) + LLM free-text estimation (Claude text) + entitlement gating + S3 photo storage + recognition cache + optional adaptive TDEE              | Net-new in M9.5 |

The two-milestone split lets us ship a complete, usable nutrition product (Tier A) without the cost / latency exposure of AI inference, then layer AI on once the data-flow and UX are proven.

**Sequencing reference:** per `specs/milestones/ROADMAP.md`, M9 follows M4. M9.5 follows M9. The 2026-05-25 ROADMAP decision pulled M9 ahead of M8 (trainer features) so the nutrition cross-cut (`specs/_shared/cross-cuts.md § 1.2`, `§ 2.1`) is read-stable when M8 lands.

This document marks every section with `[M9]` or `[M9.5]` so M9 agents can skip Tier B sections without re-reading.

---

## 2. Domain model

The nutrition surface introduces six domain entities. Three are shared between tiers; three are Tier B only.

```typescript
// [M9] — packages/mobile/src/domain/models/nutrition.ts

export type FoodSource = "off" | "manual" | "ai";

export type MealSlot = "breakfast" | "lunch" | "dinner" | "snack";

export type PortionUnit = "g" | "ml" | "oz" | "cup" | "serving";

/**
 * A food in the catalogue. OFF-sourced foods are global (visible to all users
 * via the proxy); manual + AI foods are user-scoped (only visible to the user
 * who added them). Source determines the "Verified" / "You added this" /
 * "AI estimate" badge per requirements.md STORY-002 AC 5.
 */
export interface Food {
  id: string;
  source: FoodSource;
  offBarcode: string | null; // EAN/UPC if source='off'
  ownerUserId: string | null; // null for source='off', set for manual/ai
  name: string;
  brand: string | null; // OFF `brands` field, displayed as subtitle
  caloriesPer100g: number;
  proteinPer100g: number;
  carbsPer100g: number;
  fatPer100g: number;
  defaultServingG: number | null; // OFF `serving_quantity` if present
  verifiedAt: Date | null; // when we last fetched + cached OFF
  verifiedSource: "off" | null; // for the "Verified" badge per STORY-002 AC 5
}

/**
 * A single logged entry. Macros are snapshotted at log time so subsequent
 * edits to the parent Food don't retroactively change historical logs
 * (requirements.md STORY-001 AC 4). The `logged_by_user_id` column follows
 * the trainer-on-behalf pattern in specs/_shared/cross-cuts.md § 1.1.
 */
export interface NutritionEntry {
  id: string;
  userId: string; // whose log this belongs to
  foodId: string;
  loggedAt: Date;
  mealSlot: MealSlot;
  grams: number;
  caloriesSnapshot: number;
  proteinGSnapshot: number;
  carbsGSnapshot: number;
  fatGSnapshot: number;
  loggedByUserId: string | null; // NULL=self; non-NULL=trainer-on-behalf
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MealTemplate {
  id: string;
  userId: string;
  name: string;
  entriesJson: TemplateEntry[]; // see § 3
  createdAt: Date;
}

export interface TemplateEntry {
  foodId: string;
  grams: number;
  mealSlot: MealSlot;
}

/**
 * A daily target. `set_by_user_id` follows the trainer-assigned pattern in
 * specs/_shared/cross-cuts.md § 2.1 — NULL=self-set, non-NULL=trainer-set.
 * Targets are historical: the current target is the row with effective_until=NULL.
 */
export interface NutritionTarget {
  id: string;
  userId: string;
  dailyCalories: number;
  dailyProteinG: number | null;
  dailyCarbsG: number | null;
  dailyFatG: number | null;
  dailyWaterMl: number;
  setByUserId: string | null;
  effectiveFrom: Date;
  effectiveUntil: Date | null;
  createdAt: Date;
}

export interface WaterEntry {
  id: string;
  userId: string;
  loggedAt: Date;
  volumeMl: number;
}

/**
 * Read model — composed server-side for the daily summary view.
 * Not persisted; computed from entries + target + water entries.
 */
export interface DailySummary {
  date: string; // YYYY-MM-DD, user-local
  target: NutritionTarget | null;
  consumedKcal: number;
  consumedProteinG: number;
  consumedCarbsG: number;
  consumedFatG: number;
  consumedWaterMl: number;
  entries: NutritionEntry[];
  waterEntries: WaterEntry[];
}
```

```typescript
// [M9.5] — adds nutrition photo + AI usage tracking

export type AiProvider = "anthropic_claude_vision" | "anthropic_claude_text";

export interface NutritionPhoto {
  id: string;
  userId: string;
  s3Key: string;
  recognizedItems: RecognizedItem[]; // jsonb in DB
  aiProvider: AiProvider;
  ms: number; // inference latency
  createdAt: Date;
}

export interface RecognizedItem {
  foodName: string;
  estimatedGrams: number;
  estimatedCaloriesPer100g: number;
  estimatedProteinPer100g: number;
  estimatedCarbsPer100g: number;
  estimatedFatPer100g: number;
  confidence: number; // 0..1
}
```

---

## 3. Schema [M9]

All Tier A tables ship in M9. Migrations are SQL files under `packages/db/migrations/` following the existing Drizzle + Neon idempotent pattern. Per `specs/_shared/cross-cuts.md § 6`, **nutrition_entries** and **nutrition_targets** are created here with cross-cut columns (`logged_by_user_id`, `set_by_user_id`) **built-in from day 1** — no backfill needed when M8 lights up the trainer endpoints.

### 3.1 `foods`

```sql
create table foods (
  id                  uuid primary key default gen_random_uuid(),
  source              text not null check (source in ('off', 'manual', 'ai')),
  off_barcode         text null,
  owner_user_id       uuid null references profiles(id) on delete cascade,
  name                text not null,
  brand               text null,
  calories_per_100g   numeric(8, 2) not null check (calories_per_100g >= 0),
  protein_per_100g    numeric(8, 2) not null check (protein_per_100g >= 0),
  carbs_per_100g      numeric(8, 2) not null check (carbs_per_100g >= 0),
  fat_per_100g        numeric(8, 2) not null check (fat_per_100g >= 0),
  default_serving_g   numeric(8, 2) null,
  verified_at         timestamptz null,
  verified_source     text null check (verified_source in ('off')),
  created_at          timestamptz not null default now(),

  -- OFF foods are unique by barcode; manual/ai foods are unique per owner+name
  constraint foods_off_barcode_unique unique (off_barcode) deferrable initially deferred,
  constraint foods_owner_present check (
    (source = 'off' and owner_user_id is null) or
    (source in ('manual', 'ai') and owner_user_id is not null)
  )
);

create index foods_off_barcode_idx on foods (off_barcode) where source = 'off';
create index foods_owner_idx       on foods (owner_user_id) where owner_user_id is not null;
create index foods_name_trgm       on foods using gin (name gin_trgm_ops);  -- requires pg_trgm
```

**Rationale:** denormalised per-100g macros so a snapshot at entry-write time is a simple mul. The `pg_trgm` GIN index supports fuzzy search in the food picker (matches "chicken brest" → "chicken breast"). Confirmed pg_trgm is available on our Neon plan; otherwise we fall back to LIKE-prefix.

### 3.2 `nutrition_entries`

```sql
create table nutrition_entries (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references profiles(id) on delete cascade,
  food_id                  uuid not null references foods(id),
  logged_at                timestamptz not null,
  meal_slot                text not null check (meal_slot in ('breakfast','lunch','dinner','snack')),
  grams                    numeric(8, 2) not null check (grams > 0),

  -- snapshotted at log time per requirements.md STORY-001 AC 4
  calories_snapshot        numeric(8, 2) not null,
  protein_g_snapshot       numeric(8, 2) not null,
  carbs_g_snapshot         numeric(8, 2) not null,
  fat_g_snapshot           numeric(8, 2) not null,

  -- per specs/_shared/cross-cuts.md § 1.1
  logged_by_user_id        uuid null references profiles(id),

  notes                    text null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index nutrition_entries_user_day_idx on nutrition_entries (user_id, logged_at desc);
create index nutrition_entries_user_food_idx on nutrition_entries (user_id, food_id);
```

**Rationale:** primary access path is "this user's entries for date X" → composite index on `(user_id, logged_at desc)`. `logged_by_user_id` is nullable and non-enum per cross-cuts § 1.1 — future use cases (admin, AI assistant) inherit the shape.

### 3.3 `meal_templates`

```sql
create table meal_templates (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles(id) on delete cascade,
  name          text not null,
  entries_json  jsonb not null,
  created_at    timestamptz not null default now()
);

create index meal_templates_user_idx on meal_templates (user_id);
```

**Rationale:** `entries_json` is `[{foodId, grams, mealSlot}, …]`. Storing as JSONB avoids a join table for what is logically a leaf composite — templates aren't queried by component food. Cap of 50 templates per user enforced in the service layer (requirements.md STORY-007 AC 4).

### 3.4 `nutrition_targets`

```sql
create table nutrition_targets (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references profiles(id) on delete cascade,
  daily_calories      integer not null check (daily_calories > 0),
  daily_protein_g     integer null check (daily_protein_g is null or daily_protein_g >= 0),
  daily_carbs_g       integer null check (daily_carbs_g is null or daily_carbs_g >= 0),
  daily_fat_g         integer null check (daily_fat_g is null or daily_fat_g >= 0),
  daily_water_ml      integer not null default 2000 check (daily_water_ml > 0),

  -- per specs/_shared/cross-cuts.md § 2.1
  set_by_user_id      uuid null references profiles(id),

  effective_from      date not null,
  effective_until     date null,
  created_at          timestamptz not null default now(),

  -- a user can have at most one active target (effective_until IS NULL)
  constraint nutrition_targets_one_active per (user_id) where effective_until is null
);

create index nutrition_targets_user_active_idx on nutrition_targets (user_id) where effective_until is null;
create index nutrition_targets_user_history_idx on nutrition_targets (user_id, effective_from desc);
```

**Rationale:** historical preservation with effective-range semantics. A target update writes a new row + advances the previous row's `effective_until`. The trainer-set audit row writes inside the same txn per cross-cuts § 1.4.

(Note: Postgres doesn't support partial unique constraints with the literal syntax above — the migration uses a partial unique index instead: `create unique index nutrition_targets_one_active_uq on nutrition_targets (user_id) where effective_until is null;` — flagged here so the migration author transcribes correctly.)

### 3.5 `water_entries`

```sql
create table water_entries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  logged_at   timestamptz not null,
  volume_ml   integer not null check (volume_ml > 0),
  created_at  timestamptz not null default now()
);

create index water_entries_user_day_idx on water_entries (user_id, logged_at desc);
```

**Rationale:** simple event log; daily total is `sum(volume_ml)` filtered by `date_trunc('day', logged_at, profiles.timezone)`. LIFO delete in STORY-005 AC 3 is `DELETE FROM water_entries WHERE id = (SELECT id ... ORDER BY logged_at DESC LIMIT 1)`.

### 3.6 `food_cache`

```sql
create table food_cache (
  id            uuid primary key default gen_random_uuid(),
  off_barcode   text not null unique,
  payload       jsonb not null,
  fetched_at    timestamptz not null default now()
);

create index food_cache_fetched_idx on food_cache (fetched_at);
```

**Rationale:** Open Food Facts proxy cache. Keyed on barcode; payload is the OFF response. 24h TTL per requirements.md Q7. Daily cron purges entries with `fetched_at < now() - interval '30 days'`. Insulates us from OFF rate-limit / availability shifts.

---

## 4. Schema [M9.5]

### 4.1 `nutrition_photos`

```sql
create table nutrition_photos (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references profiles(id) on delete cascade,
  s3_key            text not null,
  recognized_items  jsonb not null,
  ai_provider       text not null check (ai_provider in ('anthropic_claude_vision','anthropic_claude_text')),
  ms                integer not null,
  created_at        timestamptz not null default now()
);

create index nutrition_photos_user_idx on nutrition_photos (user_id, created_at desc);
```

**Rationale:** retains the AI proposal even if the user adjusts portions before logging (requirements.md STORY-017 AC 4 — original AI-proposed values persisted for audit). S3 lifecycle rule deletes the object after 30 days (Q8); we keep the DB row indefinitely for analytics but it becomes a dangling reference. The mobile UI surfaces "Photo no longer available" for entries older than 30 days.

### 4.2 `recognition_cache`

```sql
create table recognition_cache (
  id          uuid primary key default gen_random_uuid(),
  input_hash  text not null unique,     -- SHA-256 of normalised input
  input_type  text not null check (input_type in ('text', 'image_s3_key')),
  output      jsonb not null,            -- RecognizedItem[]
  created_at  timestamptz not null default now()
);
```

**Rationale:** identical free-text re-queries don't re-bill Anthropic. For photos, hashing the S3 key isn't useful (each upload is unique); for text, hashing the normalised description ("two slices of pepperoni pizza" → lowercase, strip punctuation, sort tokens) catches the common re-query case. Cache hit rate target: ≥ 30% on free-text path.

### 4.3 `ai_usage_log` (shared)

Per `specs/_shared/cross-cuts.md § 4.2`. This table is shared with future AI features (workout coach, programme generator). Migration ownership: **whichever AI feature ships first owns the table-creation migration; M9.5 is the first to ship AI inference**, so the M9.5 migration block creates this table.

```sql
create table ai_usage_log (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references profiles(id) on delete cascade,
  endpoint            text not null,
  request_size_bytes  integer not null,
  response_size_bytes integer not null,
  ms                  integer not null,
  created_at          timestamptz not null default now()
);

create index ai_usage_log_user_idx on ai_usage_log (user_id, created_at desc);
create index ai_usage_log_endpoint_idx on ai_usage_log (endpoint, created_at desc);
```

**Rationale:** per `specs/_shared/cross-cuts.md § 4.2` — supports cost modelling, future per-call quota tier. Index by endpoint so we can pivot cost by feature without scanning.

---

## 5. Open Food Facts integration [M9]

### 5.1 Endpoints

The mobile client never calls OFF directly — all requests proxy through our backend so we can cache, enforce User-Agent, and version-pin the schema we expect.

```
GET /foods/search?q=<query>&limit=20
GET /foods/barcode/:code
GET /foods/:id           // local lookup (off | manual | ai)
POST /foods              // create manual food (source='manual', owner=self)
```

### 5.2 Handler flow — `GET /foods/barcode/:code`

1. Validate barcode format (8/12/13/14 digit numeric, EAN/UPC).
2. Check `food_cache` for `off_barcode = :code AND fetched_at > now() - interval '24h'`. On hit, deserialise → upsert into `foods` (idempotent on `off_barcode` unique constraint) → return.
3. On miss, call OFF `GET https://world.openfoodfacts.org/api/v2/product/<code>.json` with `User-Agent: Persistence/1.0 (https://persistence.app; support@persistence.app)`.
4. On 200, write `food_cache` row + upsert `foods` row → return.
5. On 404, return `{ found: false }` with HTTP 200 (not 404 — the client distinguishes "barcode not in catalogue" from "endpoint broken").
6. On OFF 5xx or timeout (3s timeout), return HTTP 502 with `{ code: 'off_unavailable' }` — the client falls back to manual entry per STORY-002 AC 4.

### 5.3 OFF terms-of-use compliance

- **User-Agent required** per OFF policy: identify the app + contact email.
- **Attribution required**: every OFF-sourced food displays "Open Food Facts" badge in the UI per STORY-002 AC 5.
- **Data licence**: OFF is ODbL (Open Database License). Storing OFF data in our cache + per-user logs is permitted. We do NOT redistribute the data outside the app, and we do NOT submit user-entered foods back to OFF (out of scope per requirements.md).

### 5.4 Cache TTL

24h per requirements.md Q7. Daily cron (Lambda scheduled, 03:00 UTC) deletes `food_cache` rows older than 30 days. The 30-day floor avoids constant churn for products that haven't been re-queried in a week.

---

## 6. AI photo recognition [M9.5]

### 6.1 Endpoints

```
POST /nutrition/photos/presign       // returns { s3Key, uploadUrl }
POST /nutrition/recognize-photo      // body: { s3Key } → returns RecognizedItem[]
POST /nutrition/estimate-text        // body: { description } → returns RecognizedItem[]
```

### 6.2 Handler flow — `POST /nutrition/recognize-photo`

1. `assertEntitlement(userId, 'aiAccess')` per `specs/_shared/cross-cuts.md § 4.1`. On denial → HTTP 402 + `{ code: 'ENTITLEMENT_DENIED', entitlement: 'aiAccess', message, upgradeUrl }`.
2. Validate `s3Key` belongs to the requesting user (path prefix `nutrition-photos/<userId>/…`). Reject otherwise.
3. Fetch the image from S3 (presigned GET URL, server-side fetch).
4. Call Anthropic Claude Vision (model: `claude-3-5-sonnet-latest` or the current vision-capable Claude) with a system prompt that instructs structured output (see § 6.4). API key from SST Secret `AnthropicApiKey`.
5. Parse response into `RecognizedItem[]`; defensive — if parse fails, log + return HTTP 500 with `{ code: 'ai_parse_failed' }` so the client retries or falls back.
6. Inside the same txn: write `nutrition_photos` row + `ai_usage_log` row.
7. Return `{ items: RecognizedItem[], photoId, latencyMs }`.

### 6.3 Presigned upload flow

Mobile uploads directly to S3 to avoid Lambda payload-size limits and round-trip latency. Pattern mirrors the M6 avatar upload (`infra/storage.ts`), but with a private bucket + per-user prefix.

```
1. Client → POST /nutrition/photos/presign
   Server → { s3Key: "nutrition-photos/<userId>/<uuid>.jpg", uploadUrl: <presigned PUT URL, 5-min TTL> }
2. Client → PUT uploadUrl with image body (Content-Type: image/jpeg)
3. Client → POST /nutrition/recognize-photo { s3Key }
```

### 6.4 Anthropic Claude Vision prompt design

System prompt (drafted; final wording tuned during M9.5 implementation):

```
You are a nutrition-tracking assistant. Given a photo of a meal, identify each
distinct food item visible and estimate its portion in grams. Return a JSON
array of objects matching:
{
  "food_name": string (singular, lowercase, e.g. "grilled chicken breast"),
  "estimated_grams": number,
  "estimated_calories_per_100g": number,
  "estimated_protein_per_100g": number,
  "estimated_carbs_per_100g": number,
  "estimated_fat_per_100g": number,
  "confidence": number between 0 and 1
}
Rules:
- Identify max 8 items per photo.
- Decline politely (return []) if the photo contains no food.
- Estimate portions conservatively — users will adjust upward if needed.
- Use common food-table values for macros; do not invent extreme outliers.
```

### 6.5 Latency, cost, and rate-limiting

- **Latency target:** ≤ 2s p50 from upload-complete to candidates-rendered. Claude Vision typical latency ~ 1.2s; budget 800ms for network + parsing + DB writes.
- **Cost budget:** ~$0.015/call on current Anthropic vision pricing (small image, ~500 tokens response). Per requirements.md Q5, the working assumption is 30 calls/AI-tier-user/month ≈ $0.45/user; we measure against `ai_usage_log` post-launch.
- **Rate limiting:** out of scope today per `specs/_shared/cross-cuts.md § 4.3`. `aiAccess` is binary. Per-user quotas are a M9.5 follow-up if the cost picture demands it.
- **Anthropic API errors:** `429 rate_limit` → HTTP 503 + `Retry-After`; mobile sync queue handles. `5xx` → HTTP 502 + `{ code: 'ai_unavailable' }`. Timeouts at 10s.

### 6.6 Per-item confidence buckets

For STORY-017 AC 1's confidence chip:

| Confidence range | Chip label | UI colour                                    |
| ---------------- | ---------- | -------------------------------------------- |
| ≥ 0.75           | "High"     | Accent (positive)                            |
| 0.5–0.75         | "Medium"   | Neutral                                      |
| < 0.5            | "Low"      | Warning (still loggable, but extra friction) |

Low-confidence items render with a tooltip "AI is unsure — double-check the portion" inline. Never auto-log AI items; users always confirm.

---

## 7. LLM free-text estimation [M9.5]

### 7.1 Endpoint flow — `POST /nutrition/estimate-text`

1. `assertEntitlement(userId, 'aiAccess')` — identical to § 6.2 step 1.
2. Compute `inputHash = sha256(normalise(description))` where `normalise` = lowercase + strip non-alpha + tokenise + sort.
3. Check `recognition_cache` for the hash. On hit, return cached output. **No `ai_usage_log` row written for cache hits.**
4. On miss, call Claude in text-only mode with a similar system prompt to § 6.4 but without image input ("Given the description: '<description>', return a JSON array of food items with estimated portions and macros.").
5. Inside the same txn: write `recognition_cache` row + `ai_usage_log` row.
6. Return `{ items: RecognizedItem[], cached: false, latencyMs }`.

### 7.2 Free-text vs. photo cost ratio

Text-only Claude calls are ~5× cheaper than vision calls. Free-text is the lower-friction, lower-cost path; UI should not bias users away from it. STORY-016 AC 6 — the free-text path is **also the screen-reader-accessible alternative** to photo capture, per § 14.

### 7.3 Cache invalidation

`recognition_cache` rows are immutable; if Claude's macro estimates drift over time (model updates), we accept the staleness — the user adjusts portions anyway in STORY-017, and `nutrition_entries.<macro>_g_snapshot` is what lands in the historical log. Daily cron purges cache rows older than 90 days to bound storage.

---

## 8. Adaptive TDEE [M9.5, optional]

> **Status:** STORY-019 — in-milestone judgement call. Spec drafted; ship vs. defer flagged in requirements.md Q6.

### 8.1 Algorithm

MacroFactor-style weekly reverse-calc:

```
weekly_tdee_kcal = (sum_intake_kcal_7d − 7700 × weight_delta_kg_7d) / 7
```

- `sum_intake_kcal_7d` — `SELECT sum(calories_snapshot) FROM nutrition_entries WHERE user_id=? AND logged_at >= now() - interval '7 days'`.
- `weight_delta_kg_7d` — linear regression on `body_measurements` rows in the same window (use slope-over-period; absorbs day-to-day noise better than first/last).
- `7700` — kcal per kg of body weight (energy density of fat, well-established).

### 8.2 Nightly cron job

Run at 04:00 UTC after the streak engine sweep (cross-cuts § 3.4). For each user with:

- `≥ 7 nutrition_entries` days in the last 14 (≥ 60% logging cadence — Cronometer-style threshold for trustworthy data),
- `≥ 2 body_measurements` weight samples in the last 7 days,
- `current_target.set_by_user_id IS NULL` (NOT trainer-set — STORY-019 AC 5),

…compute `weekly_tdee_kcal`. If `abs(weekly_tdee_kcal − current_target.daily_calories) >= 0.10 × current_target.daily_calories`, surface a "suggested target update" on the next app open.

### 8.3 Suggestion UX

A non-blocking card on the Nutrition tab home: "Based on your last 7 days, your maintenance is closer to 2,350 kcal." Two buttons: "Accept" → writes a new `nutrition_targets` row (per STORY-010 flow), or "Dismiss" → writes a `nutrition_suggestion_dismissals` row (table created in M9.5 if STORY-019 ships) snoozing for 14 days.

### 8.4 Edge cases

- New users (< 14 days of data) — no suggestion ever. We say so on the Targets screen ("Need 2 weeks of logs to suggest adjustments").
- Cutting / bulking users (intentional deficit / surplus) — the algorithm absorbs intent. If they're losing 0.5 kg/week, TDEE = intake + 550 kcal/day, suggestion respects the deficit and recommends maintaining target unless intake has drifted. Edge case is handled by the formula itself.

---

## 9. Apple Health integration [M9]

### 9.1 Write-back via `HealthPort`

The existing `packages/mobile/src/domain/ports/health.port.ts` already exposes `writeBodyWeight` from M1. M9 extends it with nutrition write methods:

```typescript
// extends packages/mobile/src/domain/ports/health.port.ts

export interface HealthPort {
  // … existing methods (steps, calories, weight, …) …

  /**
   * Write a nutrition sample to Apple Health. iOS only — Android Health
   * Connect's nutrition surface is partial; the Android adapter returns
   * { ok: undefined } and writes nothing per requirements.md STORY-013 AC 5.
   */
  writeNutritionSample(input: {
    loggedAt: Date;
    caloriesKcal: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    mealSlot: "breakfast" | "lunch" | "dinner" | "snack";
  }): Promise<Result<void, HealthError>>;

  /**
   * Write a water sample (HKDietaryWater).
   */
  writeWaterSample(input: {
    loggedAt: Date;
    volumeMl: number;
  }): Promise<Result<void, HealthError>>;
}
```

### 9.2 Integration point

The mobile sync engine's "successful entry committed" hook (post-flush) fires `writeNutritionSample` / `writeWaterSample` as a best-effort side-effect. Failures don't roll back the entry; they log to the existing sync-error surface as "Health write skipped" per STORY-013 AC 3.

### 9.3 Permission request

The first time a user logs a nutrition entry, the mobile prompts for HealthKit write permissions for the nutrition sample types (additive to the M1 permission scope). If denied, the feature degrades — entries still save to backend; Health-write is silently skipped going forward.

### 9.4 No read-back

We do NOT read `HKDietaryEnergyConsumed` back from Apple Health. Per Q2, that would create dual-sources-of-truth (a user might log a meal in Apple Health directly and expect it to appear in our app). M9 ships unidirectional: we write, we don't read.

---

## 10. Trainer cross-cut [M9]

Per `specs/_shared/cross-cuts.md § 1.2`, M9 owns the underlying tables + handlers; M8 (trainer features) owns the trainer-scoped route wiring. M9 ships:

### 10.1 Endpoints owned by M9

```
GET    /nutrition/daily?date=YYYY-MM-DD       // user's own daily summary
POST   /nutrition/entries                     // user's own entry
PATCH  /nutrition/entries/:id                 // user's own entry
DELETE /nutrition/entries/:id                 // user's own entry
GET    /nutrition/targets                     // user's own target history
PUT    /nutrition/targets                     // user's own target update
POST   /nutrition/water                       // user's own water entry
DELETE /nutrition/water/:id                   // user's own water entry
GET    /foods/search?q=…                      // food picker
GET    /foods/barcode/:code                   // barcode lookup
GET    /foods/:id                             // food detail
POST   /foods                                 // manual food (owner=self)

GET    /meal-templates                        // user's templates
POST   /meal-templates                        // create
PATCH  /meal-templates/:id                    // rename / update entries
DELETE /meal-templates/:id                    // delete

GET    /trainers/me/clients/:clientId/nutrition/daily?date=…    // PT view
PUT    /trainers/me/clients/:clientId/nutrition/target          // PT-set target
```

### 10.2 Trainer-scoped handler — `PUT /trainers/me/clients/:clientId/nutrition/target`

1. Auth middleware validates JWT; surface `user.role`.
2. Assert `user.role IN ('personal_trainer', 'physiotherapist')` per cross-cuts § 1.3.
3. `assertTrainerCanActForClient(user.id, clientId)` per § 1.3 (existing helper in `microservices/core/src/application/relationships/`).
4. Inside one txn:
   - Advance previous active target's `effective_until = today − 1`.
   - INSERT new `nutrition_targets` row with `set_by_user_id = user.id`, `user_id = clientId`, `effective_from = today`, `effective_until = NULL`.
   - INSERT `trainer_actions_audit` row with `action_type='nutrition_target_set'`, `target_table='nutrition_targets'`, `target_row_id = new_target.id`, `payload = req.body`.
   - If audit insert fails, txn rolls back per § 1.4.2.
5. Emit `nutrition_target_set_by_trainer` notification to `clientId` per cross-cuts § 5 (deep link `/nutrition/targets`).
6. Return 200 with the new target row.

### 10.3 Trainer GET — `GET /trainers/me/clients/:clientId/nutrition/daily?date=…`

Same auth + relationship-check pattern. Handler is **literally the same** logic as `GET /nutrition/daily` with `userId = clientId` instead of `userId = ctx.user.id`. Per cross-cuts § 1.2, body shape mirrors the user's own self-read route exactly so the same response shape is reused.

### 10.4 Cross-spec ownership note

- **`13-nutrition-tracking` owns** the table schemas, the daily-summary handler logic, and the helper that composes the response.
- **`10-trainer-features` owns** the trainer-scoped routes (registers them with Elysia, wires the auth chain). M8 imports M9's helpers.

This avoids duplicate handler implementations and matches the cross-cuts § 1.2 pattern (worked examples table cites `10-trainer-features` as defining the route, while the underlying table is owned by the feature spec).

---

## 11. Mobile architecture [M9]

Hexagonal split per `specs/_agent.md § Architecture`.

### 11.1 Port — `NutritionPort`

```typescript
// packages/mobile/src/domain/ports/nutrition.port.ts

export interface NutritionPort {
  // queries
  getDailySummary(date: string): Promise<Result<DailySummary, NutritionError>>;
  searchFoods(query: string): Promise<Result<Food[], NutritionError>>;
  lookupBarcode(code: string): Promise<Result<Food | null, NutritionError>>;
  getMealTemplates(): Promise<Result<MealTemplate[], NutritionError>>;
  getTargetHistory(): Promise<Result<NutritionTarget[], NutritionError>>;

  // commands
  logFood(input: LogFoodInput): Promise<Result<NutritionEntry, NutritionError>>;
  editEntry(
    id: string,
    input: EditEntryInput,
  ): Promise<Result<NutritionEntry, NutritionError>>;
  deleteEntry(id: string): Promise<Result<void, NutritionError>>;
  logWater(volumeMl: number): Promise<Result<WaterEntry, NutritionError>>;
  removeLastWater(): Promise<Result<void, NutritionError>>;
  setTarget(
    input: SetTargetInput,
  ): Promise<Result<NutritionTarget, NutritionError>>;
  saveMealTemplate(
    input: SaveTemplateInput,
  ): Promise<Result<MealTemplate, NutritionError>>;
  replayTemplate(
    templateId: string,
  ): Promise<Result<NutritionEntry[], NutritionError>>;

  // [M9.5] — gated by aiAccess on the server
  recognizePhoto(
    s3Key: string,
  ): Promise<Result<RecognizedItem[], NutritionError>>;
  estimateText(
    description: string,
  ): Promise<Result<RecognizedItem[], NutritionError>>;
  presignPhotoUpload(): Promise<
    Result<{ s3Key: string; uploadUrl: string }, NutritionError>
  >;
}
```

### 11.2 Adapter — `SSTNutritionAdapter`

Implements `NutritionPort` against the SST API. Uses the existing `ApiPort` infrastructure; not a parallel HTTP stack. Maps wire types to domain types; surface errors as `NutritionError` discriminated union (`network`, `unauthorized`, `entitlement_denied`, `validation`, `server_error`).

### 11.3 SQLite cache schema

Mirrors the backend tables for the last 30 days of the user's own data. The food picker also caches the user's last-30-days food list locally so search-while-offline works for repeat foods.

```sql
-- packages/mobile/db/migrations/NN_nutrition.sql

create table local_nutrition_entries (
  id                      text primary key,
  user_id                 text not null,
  food_id                 text not null,
  food_name               text not null,            -- denormalised for offline render
  food_brand              text,
  food_source             text not null,            -- 'off' | 'manual' | 'ai'
  logged_at               text not null,            -- ISO 8601
  meal_slot               text not null,
  grams                   real not null,
  calories_snapshot       real not null,
  protein_g_snapshot      real not null,
  carbs_g_snapshot        real not null,
  fat_g_snapshot          real not null,
  logged_by_user_id       text,
  notes                   text,
  created_at              text not null,
  updated_at              text not null,
  sync_status             text not null             -- 'synced' | 'pending' | 'blocked_entitlement'
);

create index local_nutrition_entries_day on local_nutrition_entries (user_id, logged_at);

create table local_nutrition_targets (...);
create table local_water_entries (...);
create table local_foods (...);
create table local_meal_templates (...);
```

The denormalised `food_name`/`food_brand`/`food_source` columns let entries render offline without joining `local_foods`. Sync engine keeps both in sync via the existing M3 pattern.

### 11.4 Queries (application layer)

```typescript
// packages/mobile/src/application/queries/nutrition.ts

export function getDailySummaryQuery(date: string) { ... }
export function searchFoodsQuery(query: string) { ... }
export function getMealTemplatesQuery() { ... }
```

### 11.5 Commands (application layer)

```typescript
// packages/mobile/src/application/commands/nutrition.ts

export function logFoodCommand(input: LogFoodInput) { ... }
export function setTargetCommand(input: SetTargetInput) { ... }
export function logWaterCommand(volumeMl: number) { ... }
// … etc
```

All commands flow through the sync queue per M3 pattern. UI receives optimistic results; sync engine flushes in background.

### 11.6 Container / presenter split per `_agent.md § Container / Presenter`

| Container                         | Presenter                         | Screen file                                                            |
| --------------------------------- | --------------------------------- | ---------------------------------------------------------------------- |
| `NutritionDailyContainer`         | `NutritionDailyPresenter`         | `app/(app)/(tabs)/nutrition.tsx`                                       |
| `AddFoodModalContainer`           | `AddFoodModalPresenter`           | (modal sheet, no route file)                                           |
| `BarcodeScannerContainer`         | `BarcodeScannerPresenter`         | `app/(app)/nutrition/scan.tsx`                                         |
| `PortionConfirmContainer`         | `PortionConfirmPresenter`         | (sheet within Add Food)                                                |
| `MealTemplatesContainer`          | `MealTemplatesPresenter`          | `app/(app)/nutrition/templates.tsx`                                    |
| `NutritionTargetsContainer`       | `NutritionTargetsPresenter`       | `app/(app)/nutrition/targets.tsx`                                      |
| `PhotoCaptureContainer` [M9.5]    | `PhotoCapturePresenter` [M9.5]    | `app/(app)/nutrition/photo.tsx`                                        |
| `AiCandidatesContainer` [M9.5]    | `AiCandidatesPresenter` [M9.5]    | (sheet after photo capture)                                            |
| `TrainerClientNutritionContainer` | `TrainerClientNutritionPresenter` | `app/(app)/clients/[id]/nutrition.tsx` (M8 wires; M9 ships components) |

---

## 12. Offline strategy [M9]

Inherits the M3 sync-queue pattern wholesale; no nutrition-specific machinery beyond a few flow rules.

### 12.1 Operations and offline behaviour

| Operation                 | Online                        | Offline                                                                                          |
| ------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------ |
| Log manual food           | Immediate                     | Optimistic; sync on reconnect                                                                    |
| Scan barcode              | Lookup OFF → portion-confirm  | Camera works locally; OFF lookup queued; user can still set portion; entry hydrates on reconnect |
| Edit entry                | Immediate                     | Optimistic; sync on reconnect                                                                    |
| Delete entry              | Immediate                     | Optimistic; sync on reconnect                                                                    |
| Log water (+/-)           | Immediate                     | Optimistic; sync on reconnect                                                                    |
| Set target                | Immediate                     | Optimistic; sync on reconnect                                                                    |
| Save template             | Immediate                     | Optimistic; sync on reconnect                                                                    |
| Replay template           | Immediate (all entries write) | Optimistic for all entries; sync as a batch                                                      |
| Search foods              | API call                      | Local cache only (last-30-days user foods)                                                       |
| AI photo upload [M9.5]    | S3 PUT → recognize-photo      | **Blocked** — explicit error "Try again when connected"                                          |
| AI text estimation [M9.5] | API call                      | **Blocked** — explicit error                                                                     |
| Daily summary view        | API → cache → render          | Cache → render; "Last synced 2h ago" timestamp                                                   |

### 12.2 Sync conflict resolution

Server-wins (last-write-wins) per existing M3 pattern. Edit-during-offline → server-write → reconnect-flush → server applies. If server has a newer version (rare — only via another device), local change is dropped with a sync-error surface entry.

### 12.3 Entitlement blocking [M9.5]

Per M10.6, the mobile sync engine recognises `402 ENTITLEMENT_DENIED` responses and marks entries `blocked_entitlement`. AI-photo writes that flush while the user is on a free tier surface in the existing review screen with the upgrade CTA. On upgrade, automatic retry — no extra M9.5 wiring needed (the M10.6 retry path already covers this).

---

## 13. UI architecture [M9 + M9.5]

> **Skill principles applied:** `frontend-design` (premium gym-app aesthetic per Brad's memory; Cronometer-inspired restraint; Cal AI-inspired onboarding simplicity; Lifesum's quad-input pattern), Tamagui tokens, spring-physics animation, haptics.

### 13.1 Tamagui token usage

All screens use the existing Tamagui token system from `01-design-system`. Specific nutrition-facing tokens:

- `$nutritionRingTrack` — neutral grey (low alpha) for the unfilled ring portion.
- `$nutritionRingFillOnTrack` — accent colour for in-target ring.
- `$nutritionRingFillOver` — warning colour for ≥ 110% target.
- `$macroProtein`, `$macroCarbs`, `$macroFat` — three distinct macro colours, all contrast-tested 4.5:1 against background.
- `$waterTileSurface` — water-tile-specific background (subtle gradient).

No new colour tokens beyond these; everything else reuses the design system.

### 13.2 Screen: Nutrition tab home (`/nutrition`)

**Information architecture (top to bottom):**

1. Header: "Today, 26 May" with horizontal date strip (scroll left for past 30 days, right is hard-stop at today).
2. **Primary calorie ring** (60% of viewport height up to a 320pt cap). Centre: "1,450 / 2,200 kcal". Below ring: "750 kcal left" or "180 kcal over". Tap → opens calorie-detail tile with macro breakdown for the day.
3. **Three macro bars** (Protein, Carbs, Fat). Each: label + "consumed / target g" + percent fill bar. Tap → opens 1-week macro detail (STORY-004 AC 3).
4. **Water tile** (full-width card). Current ml + target ml + `+250 ml` and `+500 ml` big buttons + `-` undo. Long-press the `+` buttons → custom-amount sheet.
5. **Today's entries** grouped by meal slot. Each group: slot header (icon + name + slot calorie subtotal), entries below. Each entry: food name + brand (if present) + portion + source badge + kcal. Tap → edit; long-press → "Log again" / "Delete".
6. **Floating "+" CTA** (bottom-right) opens the Add Food modal.

**Primary affordances:** date scrub, "+" CTA, water tap-add.

**Visual language:** generous spacing per Brad's memory ("Premium gym-app aesthetic, not generic UI"). Ring is the hero — bold, centred, animated. Macro bars are thin (4pt) to keep the ring central. Water tile sits below as a deliberate secondary surface. Entries list at the bottom is data-dense but not cramped — 56pt row height, 12pt internal padding.

**Animation guidance:**

- Ring fill animates with spring physics on entry (Reanimated `withSpring`, damping 14, stiffness 90, mass 1). On each new log, the ring animates from current to new fill in 350ms.
- Water tile: +/- button taps trigger a `withSpring` water-level rise + a single haptic (`Haptics.ImpactFeedbackStyle.Light`).
- Target-hit (STORY-003 AC 4): when calorie ring crosses 100%, a one-shot ring "pulse" animation (scale 1 → 1.05 → 1, 600ms) + success haptic.

**Empty/error/loading states with personality:**

- Empty (no entries today): "Time to break the fast. Log your first meal." with a single CTA pill, no stock illustration.
- Loading (offline-cache empty): skeleton placeholders for ring + bars + entries list. Skeleton ring shows a static 0% fill.
- Offline indicator: top-of-screen pill "Showing local — last synced 2h ago" when offline.
- Error (e.g. backend 5xx with no cache): "Couldn't load today. Pull to retry." with the day's `+` CTA still tappable (offline write still works).

### 13.3 Screen: Add Food modal (sheet)

**Information architecture:**

A bottom sheet (Tamagui `Sheet`) that opens at 80% viewport height. Tabs at the top, single column below.

**Tabs (Lifesum-inspired quad input, all on one screen with method toggle):**

1. **Search** — text input + recent foods list + search results below. Default tab.
2. **Barcode** — opens full-screen camera (separate screen — `/nutrition/scan`).
3. **Photo** [M9.5] — opens full-screen camera (separate screen — `/nutrition/photo`). On free tier: tapping the tab fires `useFeatureGate('aiAccess')` → opens `FeatureGatePrompt` (M10.5 primitive) rather than navigating.
4. **Free-text** [M9.5] — text input + submit button. Same entitlement gate as Photo.

**Primary affordances:** method-switch tabs; tap-to-log on a food row; long-press for "Log as template".

**Animation:** tab switch is instant (no slide). Sheet opens with spring (350ms entry).

**Empty/error/loading states:**

- Search-empty (no query yet): "Search foods or scan a barcode" with the user's recent foods listed below (STORY-006 AC 1).
- Search-no-results: "No matches in our catalogue. Try a barcode, or [Log manually]." — the "Log manually" CTA opens a manual-food sheet (STORY-001 AC 4 fallback).
- Recent foods empty (first-time user): "Your recent foods will appear here. Log your first meal to get started."

### 13.4 Screen: Food search modal (within Add Food, Search tab)

**Source-disambiguation badges per STORY-002 AC 5:**

- "Verified" (with subtle checkmark icon) — OFF foods with high data-quality tags (Q12 threshold).
- "Open Food Facts" — OFF foods without verified tags.
- "You added this" — `source='manual'`, `owner_user_id = self.id`.
- "AI estimate" — `source='ai'`, `owner_user_id = self.id`.

**Cronometer-inspired restraint:** no upsell badges, no banner ads, no "sponsored" rows. Search results are unbiased — order is fuzzy-match score, deduplicated within source.

**Recent foods at top** when no query (STORY-006).

### 13.5 Screen: Barcode scanner (`/nutrition/scan`)

Full-screen camera (Expo `BarCodeScanner`). Minimal chrome:

- Top: thin "Scan a barcode" header with close (X) button.
- Centre: barcode crosshair overlay (subtle).
- Bottom: "Or [Search manually]" affordance.

On scan: success haptic, brief vibrate, immediate transition into portion-confirm sheet. No "scan another" mode — one scan, then portion-confirm.

### 13.6 Screen: Portion-confirm card (sheet)

The single most-used UI surface in the feature. Renders in two contexts:

1. After a food picker selection (STORY-001).
2. After a barcode scan (STORY-002).
3. After AI photo capture (STORY-015) — rendered N times, one card per recognised item.
4. After AI text estimation (STORY-016) — rendered N times.

**Information architecture:**

- Food header: name + brand (if present) + source badge.
- Portion input: numeric stepper (+/- 25g) + custom-amount text input. Long-press the stepper for ±100g increments.
- Live-recomputing macro readout: "180 kcal · 28g P · 5g C · 5g F" updates as portion changes.
- Meal-slot picker: four big buttons (breakfast, lunch, dinner, snack). Default to current-time-of-day default (07:00 → breakfast, 12:00 → lunch, etc.).
- Optional notes input (collapsed by default; tap "Add note" to expand).
- Primary CTA: "Log".
- Secondary: "Cancel".

**Cal AI-inspired simplicity:** one screen, one decision — log this food at this portion. No upsell, no related-foods carousel, no "this looks similar".

**For AI-sourced cards (STORY-017):**

- Confidence chip in header ("High" / "Medium" / "Low" per § 6.6).
- Per-card "Reject" affordance (top-right X) drops the item from the batch.
- After the last card, a "Log all" CTA at the bottom of the batch list to commit all confirmed items at once.

### 13.7 Screen: Photo capture [M9.5] (`/nutrition/photo`)

Cal AI-inspired minimal chrome:

- Full-screen camera, no overlay clutter.
- Single capture button (bottom-centre, 80pt diameter).
- Top: small "Snap your meal" caption + close button.
- After capture: a "AI is analysing…" loading state with a contextual progress hint ("Identifying foods… Estimating portions…" — two-stage copy that animates through the steps).
- On result: transition into the per-item portion-confirm sequence (§ 13.6).

### 13.8 Screen: Daily summary detail (`/nutrition` past-day view)

Same layout as the home tab but read-only when viewing a date < today:

- No "+" CTA (cannot log to a past day from the date strip — must use the entry's edit-date affordance).
- Header date shows the past date.
- Entries list shows the day's entries; tap to view (read-only); long-press shows only "Log again" (to today) — no "Delete" from the past-day view (delete must be initiated from today's view).

**Weekly rollup tile** (above entries): "This week's average — 1,820 kcal · 130g P · 200g C · 60g F" with a 7-day mini-chart.

### 13.9 Screen: Targets (`/nutrition/targets`)

**Information architecture:**

- Current target card (top): kcal + macros + water. If trainer-set, "Set by Coach Bradley" badge per cross-cuts § 1.5.
- "Update target" CTA (or "Set a target" if none active) → opens the update modal.
- History (collapsible): last 6 active targets with effective ranges. Trainer-set rows labelled accordingly.
- Manage templates sub-link (entry to the templates list).

**Update modal:**

- Five inputs: kcal, protein g, carbs g, fat g, water ml. Macro inputs optional.
- Live warning chip when `4·P + 4·C + 9·F` diverges from kcal by > 15% — not blocking.
- Save → writes new target row, advances previous `effective_until`.

### 13.10 Screen: Trainer-visible client nutrition (`/clients/[id]/nutrition` — wired by M8)

A read-only mirror of the client's daily summary. Same components as `NutritionDailyPresenter` but in read-only mode (no `+` CTA, no edit, no long-press menus). Header: "<Client name> · 26 May". M9 ships the presenter; M8 wires the route + container.

---

## 14. Accessibility (WCAG 2.1 AA) [M9 + M9.5]

> **Skill principles applied:** `design:accessibility-review` — WCAG 2.1 AA contrast, touch targets ≥ 44pt, `accessibilityLabel` everywhere, focus order, screen-reader alternatives.

### 14.1 Per-screen accessibility checklist

**Nutrition tab home:**

- Calorie ring: 4.5:1 contrast between ring fill and background. **Colour is never the only signal** — the numeric label inside the ring is the primary affordance; percent text below reinforces. Screen reader announces "Today's nutrition: 1,450 of 2,200 calories consumed, 750 calories remaining" when the screen opens.
- Macro bars: each bar is colour-coded AND labelled with macro name. SR announces "Protein: 80 of 120 grams, 66% of target."
- Water tile: tap targets `+250 ml` and `+500 ml` are 56×56pt (above the 44pt minimum); long-press affordance announced as "Long press for custom amount."
- Entries list rows: minimum 56pt height (well above 44pt). Each row's accessibility label combines food name + portion + meal slot + kcal: "Grilled chicken breast, 200 grams, lunch, 330 calories. Double-tap to edit."

**Add Food modal:**

- Method toggle tabs: each tab is a discrete `accessibilityRole='tab'` with state announcement ("Search tab, selected" / "Photo tab, locked, requires AI access").
- Search input: standard text input semantics.
- Recent foods list: each row labelled with name + last-used date.

**Barcode scanner:**

- Camera does not require sight to use (barcode reader works whenever the camera frames a barcode). However: a "Search manually" CTA at the bottom is the keyboard / screen-reader alternative.

**Portion-confirm card:**

- Numeric stepper: each +/- button has discrete label ("Increase portion by 25 grams"). Screen reader announces value changes.
- Custom-amount text input: labelled "Portion in grams" with hint "Enter a number".
- Meal-slot buttons: each labelled with slot name + selected state.
- Live macro readout: marked as `aria-live='polite'` (`accessibilityLiveRegion='polite'` on RN) so SR announces "180 calories, 28 grams protein" as the portion changes — but throttled to every 500ms to avoid SR over-firing on slider drags.

**Photo capture [M9.5]:**

- Capture button: 80×80pt (way above 44pt minimum), labelled "Capture meal photo".
- **Screen-reader-accessible alternative:** the Free-text tab (STORY-016 AC 6). Users who cannot frame a photo describe the meal in text instead — first-class input method, not a hidden fallback.

**Targets screen:**

- All inputs have explicit `accessibilityLabel`.
- Live warning chip: announced as `accessibilityLiveRegion='polite'` when it appears.

### 14.2 Focus order

Documented in `_agent.md` testing patterns. For VoiceOver / TalkBack, the focus order on the home tab is:

1. Date strip (left/right scrollable; SR users can swipe past).
2. Calorie ring (announces summary).
3. Macro bars (in order: Protein → Carbs → Fat).
4. Water tile (announces value; +250 button; +500 button; - button).
5. Entries list (grouped by meal slot; SR announces "Breakfast group, 3 items" then traverses).
6. Floating "+" CTA (last in focus order — primary action, easy to find).

### 14.3 Animation respects reduced motion

When `useReducedMotion()` is true:

- Ring fill jumps instead of springs.
- Water-tile water-level rise is replaced with a static refresh.
- Target-hit pulse is replaced with a static colour-change.
- Sheet transitions remain (sheet is a navigation primitive, not a flourish).

---

## 15. Notification triggers [M9]

Per `specs/_shared/cross-cuts.md § 5`, the Nutrition feature emits one event:

| Event                      | Type enum                    | Default opt-in | Deep link    |
| -------------------------- | ---------------------------- | -------------- | ------------ |
| Daily nutrition target hit | `daily_nutrition_target_hit` | **off**        | `/nutrition` |

**Off by default** because daily target-hit fires once per day per user with a target — that's noisy across a userbase. Users who want the dopamine can opt in via the M7 preferences UI.

**Trainer-side event:**

| Event                           | Type enum                         | Default opt-in | Deep link            |
| ------------------------------- | --------------------------------- | -------------- | -------------------- |
| Nutrition target set by trainer | `nutrition_target_set_by_trainer` | on             | `/nutrition/targets` |

This event is **emitted from the trainer endpoint** (STORY-011 AC 4) but the enum value is owned by M7's notification migration per cross-cuts § 5. M9's design.md flags the new value here; M7 absorbs it when it ships.

**Streak engine integration (out of scope for M9 but cross-cut for awareness):**

`nutrition_streak` is one of the four streak types per cross-cuts § 3.1 (period = days; satisfied when daily calorie total falls within target ± tolerance, default ±10%). The streak engine itself ships in M4 (per cross-cuts § 6); M9's nutrition writes trigger streak-engine `evaluateStreaks(userId, eventType='nutrition_logged', ts)` calls if a `user_streaks` row with `streak_type='nutrition_streak'` exists for the user. No new code on M9's side — the streak engine consumes the event types it's instructed to watch.

---

## 16. Cost & rate-limiting [M9.5]

### 16.1 Anthropic API key as SST Secret

```typescript
// infra/secrets.ts (extension in M9.5)

// Anthropic API key for Claude Vision (photo recognition) and Claude text-mode
// (LLM free-text estimation). Server-side only; never exposed to mobile.
// Set per-stage via `bunx sst secret set AnthropicApiKey "<value>" --stage <stage>`.
// Never file-commit. Repo is PUBLIC since 2026-05-14.
export const anthropicApiKey = new sst.Secret("AnthropicApiKey");
```

The mobile client never sees this key. All Claude calls happen on the Lambda; the mobile gets back the parsed RecognizedItem[] only.

### 16.2 Cost model

| Metric                            | Working assumption | Source                                                          |
| --------------------------------- | ------------------ | --------------------------------------------------------------- |
| Claude Vision cost per photo      | ~$0.015            | Anthropic pricing 2026-05; small image, ~500-token response     |
| Claude text estimation cost       | ~$0.003            | ~5× cheaper than vision (same response size, no image input)    |
| Avg AI-tier user calls/month      | 30                 | Q5 working assumption; refined post-launch via `ai_usage_log`   |
| Recognition-cache hit rate (text) | ≥ 30% target       | Common foods / re-queries; bound by user input diversity        |
| Avg cost per AI-tier user/month   | ~$0.45             | (30 × $0.015) = $0.45 with no cache; add cache, falls to ~$0.35 |

**Out of scope today** per `specs/_shared/cross-cuts.md § 4.3`:

- Per-call rate limiting / quota tier.
- Free-tier trial (e.g. "5 free recognitions").

**`ai_usage_log` analytics queries** (post-launch):

```sql
-- Monthly cost per user (assuming $0.015/vision, $0.003/text)
SELECT user_id,
       count(*) FILTER (WHERE endpoint = '/nutrition/recognize-photo') AS vision_calls,
       count(*) FILTER (WHERE endpoint = '/nutrition/estimate-text') AS text_calls,
       count(*) FILTER (WHERE endpoint = '/nutrition/recognize-photo') * 0.015
         + count(*) FILTER (WHERE endpoint = '/nutrition/estimate-text') * 0.003 AS est_cost_usd
FROM ai_usage_log
WHERE created_at >= now() - interval '30 days'
GROUP BY user_id
ORDER BY est_cost_usd DESC
LIMIT 100;
```

### 16.3 S3 photo cost

Photos are JPEG (mobile-side compression to 1024×1024 max, 80% quality → ~150 KB avg). At 30 photos/month/AI-tier-user, that's 4.5 MB/user/month. S3 Standard at $0.023/GB-month → ~$0.0001/user/month. Negligible; not a budget concern.

S3 lifecycle rule: photos older than 30 days are deleted per Q8. Implement as a bucket lifecycle policy in `infra/storage.ts` extension.

---

## 17. Migration sequencing

Per `specs/_shared/cross-cuts.md § 6`:

| Migration                                       | Milestone               | Notes                                                                                           |
| ----------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------- |
| `foods`                                         | **M9**                  | Core catalogue table. Includes `pg_trgm` GIN index — verify extension available on Neon.        |
| `nutrition_entries` (incl. `logged_by_user_id`) | **M9**                  | Cross-cut column built-in from day 1 per § 6 — no backfill when M8 lights up trainer endpoints. |
| `meal_templates`                                | **M9**                  |                                                                                                 |
| `nutrition_targets` (incl. `set_by_user_id`)    | **M9**                  | Cross-cut column built-in from day 1.                                                           |
| `water_entries`                                 | **M9**                  |                                                                                                 |
| `food_cache`                                    | **M9**                  | OFF proxy cache.                                                                                |
| `nutrition_photos`                              | **M9.5**                |                                                                                                 |
| `recognition_cache`                             | **M9.5**                |                                                                                                 |
| `ai_usage_log`                                  | **M9.5**                | First AI feature ships this. Future AI features (workout coach) consume the same table.         |
| `nutrition_suggestion_dismissals`               | M9.5 if STORY-019 ships | Otherwise deferred indefinitely.                                                                |

All migrations are SQL files under `packages/db/migrations/`. Idempotent (`CREATE TABLE IF NOT EXISTS`, partial unique indexes with named constraints). Tested forward + backward per `CLAUDE.md § Database & Migrations`.

---

## 18. Testing strategy

Per `CLAUDE.md § Testing Rules` — 90% coverage threshold, no fake tests.

### 18.1 Backend coverage targets

- `microservices/core/src/application/nutrition/services/*` — every service method tested.
- `microservices/core/src/application/nutrition/repositories/*` — every repo method tested with two-user isolation tests (per § Dangerous Areas / User Data Isolation in `CLAUDE.md`).
- OFF proxy handler — mocked OFF responses (200, 404, 5xx, timeout) all exercised.
- Trainer-on-behalf endpoint — verify audit row written + verify 403 for unrelated trainer + verify 403 for non-trainer role.
- Entitlement guard — verify 402 response shape matches M10.5 contract.

### 18.2 Mobile coverage targets

- `application/queries/nutrition/*` + `application/commands/nutrition/*` — unit tested with in-memory adapter.
- Presenters — RTL render with props for: empty, loading, error, populated states.
- Containers — integration tested with in-memory adapter for the happy path + entitlement-denied path + offline-write path.
- Critical paths: log → see entry; scan → see entry; edit → see updated; delete → entry gone; target hit → notification fires.

### 18.3 E2E smoke (per `specs/milestones/M9-nutrition/SMOKE_TEST.md` — authored at milestone-brief time)

- Manual log → daily ring updates.
- Barcode scan → OFF lookup → log → entry on day.
- Set target → ring reflects.
- Offline log → reconnect → entry syncs.
- Trainer sets client target → client sees attribution + notification.

---

## 19. Open design decisions (flagged for Brad)

| #   | Decision                                                                                                      | Default lean                                                                                | Need input?                 |
| --- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------- |
| D1  | Use `pg_trgm` for food search or LIKE-prefix fallback?                                                        | `pg_trgm` if available on Neon; verify before M9 brief is cut                               | No — verify in M9 brief     |
| D2  | OFF User-Agent contact email                                                                                  | `support@persistence.app` placeholder; needs a real address before launch                   | **Yes — Brad input**        |
| D3  | STORY-019 adaptive TDEE — ship in M9.5 or defer?                                                              | Defer if M9.5 is on critical path; ship if there's slack                                    | **Yes — Brad input**        |
| D4  | Cap entries per day (anti-abuse)                                                                              | 100 entries/day soft cap; reject 101st with `code='daily_log_full'`                         | Lean default; flag for Brad |
| D5  | Trainer can log entries on a client's behalf (cross-cuts § 1.1 includes the column but doesn't ship endpoint) | M9 ships the column; M8 owns the `POST /trainers/me/clients/:id/nutrition/entries` endpoint | Per cross-cuts; no input    |
| D6  | Multi-language food names (OFF returns multilingual)                                                          | M9 uses `en` only; localised names are Tier C                                               | Lean default                |
| D7  | Cents-precision macros (e.g. 18.5g P) or integer-only                                                         | Numeric(8,2) in DB; UI renders integer-only above 10g, one decimal under 10g                | Lean default                |

---

**Spec trace:** every STORY in `requirements.md` is implemented by sections in this document; every task in `tasks.md` cites one STORY + AC and one section here.
