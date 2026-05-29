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

| Method | Path                                 | Description                                                                                                         |
| ------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| GET    | `/nutrition/today`                   | Aggregate for Fuel screen: `{ targets, consumed: { kcal, protein, carbs, fat, water }, entries: NutritionEntry[] }` |
| GET    | `/nutrition/entries?date=YYYY-MM-DD` | Day's entries                                                                                                       |
| POST   | `/nutrition/entries`                 | Log entry                                                                                                           |
| PUT    | `/nutrition/entries/:id`             | Edit entry                                                                                                          |
| DELETE | `/nutrition/entries/:id`             | Remove entry                                                                                                        |
| GET    | `/nutrition/targets`                 | Current targets                                                                                                     |
| PUT    | `/nutrition/targets`                 | Update targets (self)                                                                                               |
| GET    | `/nutrition/water/today`             | Today's water                                                                                                       |
| PATCH  | `/nutrition/water/today`             | Increment / decrement (delta)                                                                                       |
| POST   | `/nutrition/barcode/resolve`         | Resolve barcode → Food row (creates from Open Food Facts if not in `foods`)                                         |
| GET    | `/foods?query=`                      | Search foods                                                                                                        |
| POST   | `/foods`                             | User creates a custom food                                                                                          |
| GET    | `/recipes`                           | User's recipes                                                                                                      |
| POST   | `/recipes`                           | Create recipe (manual)                                                                                              |
| POST   | `/recipes/import`                    | Import from URL (server scrapes — SSRF-hardened, see § Recipe-import SSRF guards)                                   |
| GET    | `/recipes/:id`, `PUT`, `DELETE`      | CRUD                                                                                                                |
| GET    | `/meals`, `POST`, `PUT`, `DELETE`    | CRUD                                                                                                                |

### M9.5 Tier B (all gate on `aiAccess` via `assertEntitlement` per cross-cuts § 4.1)

| Method | Path                            | Description                         |
| ------ | ------------------------------- | ----------------------------------- |
| POST   | `/nutrition/ai/recognize-photo` | Multipart photo → recognised items  |
| POST   | `/nutrition/ai/estimate-text`   | Free-text → macro estimate          |
| POST   | `/recipes/ai/extract-photo`     | OCR + LLM extract structured recipe |

All AI endpoints:

1. First line: `await assertEntitlement(ctx.userId, 'aiAccess')`. On denial → 402 + `ENTITLEMENT_DENIED` payload per cross-cuts § 4.1.
2. Log to `ai_usage_log` per § 4.2.
3. Return structured response.

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

Backend hook: end-of-day cron at 02:00 UTC (sibling of `06-progress-goals § Streak cron`). For each user, compute `dailyKcalTotal(today)` + check against `nutrition_targets.daily_kcal`. Within ±10% → period satisfied → engine advances. Outside → freeze-token check (per § 3.5) or break.

Real-time evaluation on `POST /nutrition/entries`: skip — daily total volatile until day ends. Cron handles it.

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
