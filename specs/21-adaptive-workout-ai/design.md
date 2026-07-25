# 21 — Loadout: Design

> Companion to `requirements.md` (2026-07-25). Architecture for every phase.
> Reuses the shipped exercise/equipment stack, the M9.5 Bedrock harness and the
> #156 entitlement + ceiling pattern. The generation pipeline is deliberately
> twinned with `specs/26-mealprint-meal-planning/design.md` § 1 — see § 1.

---

## 0. Premise corrections that shape this design

`requirements.md` § Premise correction records them; the consequences here:

| Inherited premise                               | Reality                                                                                                                  | Consequence                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| "Reuse the deterministic substitute ranker"     | No ranker in TypeScript. An orphaned SQL function `get_alternative_exercises` (0 callers) + a client-side muscle filter. | § 6 builds it, reconciling with the orphaned scoring formula.      |
| "Equipment filtering already exists"            | `equipmentAny` is overlap (`&&`). Loadout needs containment (`@>`).                                                      | § 6.1 adds an `equipmentSubsetOf` axis.                            |
| "Mobile paywall is catalog-driven" (GTM § 3 P0) | Both paywall presenters hardcode `find(t => t.tierName === "premium")`.                                                  | § 9.3 — P0 must edit them; "degrades gracefully" is not automatic. |
| "`profiles.available_equipment` is the store"   | Write-only, never read, unvalidated (a test writes `"dumbbells"` into `uuid[]`).                                         | `saved_gyms` supersedes it; the column is left untouched.          |

---

## 1. Twinning contract — candidate-constrained generation

This is the canonical statement of the pattern; `specs/26-mealprint-meal-planning`
§ 1 mirrors it for food. **Neither feature may let a model name a domain entity.**

```
[1] CANDIDATE ASSEMBLY (deterministic, SQL)
    - hard-filter the exercise library to what is actually performable:
      equipment containment + muscle relevance + the caller's visibility
      predicate. Cap ~400 rows.
[2] SELECTION
    - v1: DETERMINISTIC ranker (§ 6). No model, no ceiling, no cost.
    - later (optional): model composition, forced tool use, choosing
      `exerciseId` values FROM the candidate list only.
[3] VERIFICATION (deterministic, server)
    - re-resolve every chosen id against the candidate set; re-assert
      equipment containment and read-visibility; carry the parent row's
      sets/reps/rest/order/superset unchanged.
[4] DRAFT-CONFIRM (mobile)
    - review step; nothing persists until the user saves.
```

Two rules inherited from the M9.5 eval lesson and `aiBedrockClient.ts:221-230`
(_Bedrock does not hard-validate `tool_use.input` against `input_schema`_):

- **An id that is not in the candidate set is a parse failure**, not a fallback.
  Throw `AiUnreadableError` → 422. Never the "fabricate the row on miss"
  behaviour of `resolveIngredientFood.ts:18-46` — an exercise id must resolve to
  a real catalogue row.
- **Programme structure is a database property, not a model property.** Sets,
  reps, rest, order and superset grouping are copied from the parent; no model
  output is ever trusted for them.

---

## 2. Data model

Migrations live in **`supabase/migrations/`** (`CLAUDE.md`'s
`packages/db/migrations/` reference is stale), named
`YYYYMMDDHHMMSS_snake_case.sql`, idempotent, with `schema.ts` mirrored in the
same commit. Templates: `20260712120000_workouts_show_in_owner_library.sql`
(add column), `20260708130000_client_ai_summaries.sql` (create table + named
indexes + RLS).

### 2.1 `saved_gyms` (new table)

```sql
CREATE TABLE IF NOT EXISTS saved_gyms (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name               text NOT NULL,
  equipment_type_ids uuid[] NOT NULL DEFAULT '{}',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Named (not inline UNIQUE) so the name matches uniqueIndex("…") in schema.ts.
-- Case/whitespace-insensitive per AC-7.4.
CREATE UNIQUE INDEX IF NOT EXISTS saved_gyms_user_name_key
  ON saved_gyms (user_id, lower(btrim(name)));

CREATE INDEX IF NOT EXISTS saved_gyms_user_created_idx
  ON saved_gyms (user_id, created_at DESC);

ALTER TABLE saved_gyms ENABLE ROW LEVEL SECURITY;  -- backend-only, zero policies
```

- **`equipment_type_ids` cannot carry a FK** (Postgres has no array-element
  FKs). Validity is enforced in the repository: every id must exist in
  `equipment_types` or the write is `400`. This is the same posture as
  `exercises.equipment_required`, which is also unconstrained.
- RLS-on-with-zero-policies is the house default for backend-only tables
  (`client_ai_summaries` precedent): closed to PostgREST, open to the pooler
  connection `getDb()` uses.
- The Drizzle mirror needs an **expression** index (`lower(btrim(name))`), so
  `uniqueIndex("saved_gyms_user_name_key")` must take an SQL fragment rather
  than a bare column. Verify the installed drizzle version accepts an SQL
  expression in `.on()`; if it does not, declare the index in SQL only and add
  a code comment — the index still exists in the database, Drizzle only needs
  it for introspection parity.

### 2.2 Workout linkage

```sql
ALTER TABLE workouts
  ADD COLUMN IF NOT EXISTS parent_workout_id uuid
    REFERENCES workouts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS variation_kind text,
  ADD COLUMN IF NOT EXISTS source_gym_id uuid
    REFERENCES saved_gyms(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_equipment_type_ids uuid[];

CREATE INDEX IF NOT EXISTS workouts_parent_idx
  ON workouts (parent_workout_id) WHERE parent_workout_id IS NOT NULL;
```

plus an idempotent CHECK (guarded with the
`IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = …)` pattern from
`20260703120000_programs_unified_model.sql`):

```sql
ALTER TABLE workouts ADD CONSTRAINT workouts_variation_kind_check
  CHECK (variation_kind IS NULL OR variation_kind IN ('loadout'));
```

**`ON DELETE SET NULL` is deliberate.** With § 4's library predicate, deleting a
parent turns its variations into ordinary standalone workouts that reappear in
the owner's library — they are never silently destroyed (AC-5.4), and no
cleanup job is needed. `CASCADE` would delete a user's training history's
worth of variations behind one tap; `RESTRICT` would make parents undeletable.

**`source_equipment_type_ids` is a frozen snapshot**, not a join. A saved gym
can be renamed, re-kitted or deleted (AC-7.3); the variation must still be able
to say what it was built for.

**Extension beyond locked decision D2.** D2 named three columns; this adds
`source_equipment_type_ids` (required by AC-5.2 / AC-7.3) and the two
provenance columns below (required by AC-3.3 persisting past save). The minimal
alternative — recomputing the diff against the parent at read time — breaks the
moment either side is hand-edited. Flagged for Brad; cheap to drop if refused.

### 2.3 Per-row provenance

```sql
ALTER TABLE workout_exercises
  ADD COLUMN IF NOT EXISTS substituted_from_exercise_id uuid
    REFERENCES exercises(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS substitution_reason text;

-- workout_exercises has NO indexes declared today and is on the hot read path
-- for every workout fetch; variations multiply its row count.
CREATE INDEX IF NOT EXISTS workout_exercises_workout_idx
  ON workout_exercises (workout_id);
```

Swap count is **derived** (`count(substituted_from_exercise_id)`), so it can
never drift from the rows. The reason line survives into the saved variation,
which is what makes a two-week-old variation legible.

### 2.4 Programme linkage (Phase 4)

Same shape on `workout_programs`: `parent_program_id`, `variation_kind`,
`source_gym_id`, `source_equipment_type_ids`, the partial index and the CHECK.
A programme variation is a new `workout_programs` row whose `program_workouts`
point at **workout variations** of the originals — one mechanism, two levels.
`program_workouts.position` is preserved exactly.

### 2.5 `schema.ts` mirror

Add the columns to `workouts` (L613), `workoutExercises` (L634),
`workoutPrograms` (L1090); add `savedGyms` near `equipmentTypes` (L304); export
`SavedGym`/`NewSavedGym` in the `$inferSelect` block (L1674+). No `relations()`
wiring — this codebase has none; joins are hand-written.

> Live-DB drift warning: `equipment_types.description` is in `schema.ts` but
> **not in the live database** — a bare `select()` 500s
> (`exerciseRepository.ts:604-610`). Every new query in this spec uses an
> explicit projection.

---

## 3. Endpoints

All mounted in a **new `loadoutRoutes.ts` sub-app**, not on the root chain.
The root `.use()` chain in `api.ts` is at TS's instantiation-depth ceiling —
spec-25 hit TS2589 there and had to nest. Precedent sub-apps: `nutritionRoutes`,
`subscriptionsRoutes`, `trainersOnBehalfRoutes`.

| Method   | Path                            | Phase | Guard              | Notes                                                |
| -------- | ------------------------------- | ----- | ------------------ | ---------------------------------------------------- |
| `GET`    | `/saved-gyms`                   | 0     | auth               | caller's gyms, newest first                          |
| `POST`   | `/saved-gyms`                   | 0     | auth               | 409 on duplicate name; 400 on unknown equipment id   |
| `PATCH`  | `/saved-gyms/:id`               | 0     | auth + ownership   | name and/or equipment                                |
| `DELETE` | `/saved-gyms/:id`               | 0     | auth + ownership   | variations survive (`source_gym_id` → NULL)          |
| `GET`    | `/workouts/:id/variations`      | 0     | auth + parent read | caller-owned variations of that parent               |
| `POST`   | `/workouts/:id/variations`      | 0     | auth + **loadout** | persist a reviewed adaptation; 402 when not entitled |
| `POST`   | `/workouts/:id/loadout/preview` | 1     | auth + **loadout** | compute, persist nothing                             |
| `POST`   | `/ai/equipment-scan`            | 3     | auth + **loadout** | + daily ceiling (§ 8)                                |
| `GET`    | `/exercises/substitutes`        | 1     | auth               | ranked picker feed (§ 6.4)                           |

Route-ordering: all Loadout paths are 2–3 segments under distinct prefixes, so
none collides with the `/workouts/:id` or `/exercises/:id` matchers. `GET
/exercises/substitutes` **must be registered before `exercisesGetHandler`** —
the same trap `api.ts:119-121` documents for `exercisesSearchHandler`.

Handler boilerplate is the repeated per-handler `.derive(getAuthUser)` +
`.onBeforeHandle(requireAuth)` + `.use(Service)` shape — there is no shared
auth plugin in this codebase; follow the local convention rather than inventing
one.

### 3.1 Repository conventions

`SavedGymRepository` + a `SavedGymService` Elysia decorator (three lines,
mirroring `workoutService.ts`). Method signatures follow the house rule
observed in `workoutRepository.ts`: **list/create take `(userId, …)`; per-row
reads/writes take `(id, userId, …)`**.

Ownership is folded into the `WHERE` of the mutating statement — never a
separate `SELECT` first (`workoutRepository.ts:406-411`: _"no separate SELECT,
no TOCTOU window"_), and a zero-row result is a **404**, with no 403/404
distinction.

---

## 4. Library pollution

`workoutRepository.buildListWhereClause` (L448) `mine` branch is
`eq(workouts.createdBy, userId)` with no exclusion. Four Loadout variations
would become four extra cards in "My Workouts".

Fix: add `isNull(workouts.parentWorkoutId)` to the `mine` branch only.

Rejected alternative: setting `show_in_owner_library = false` on variations.
That column has a specific, documented meaning (coach-authoring de-crowding,
migration `20260712120000`); overloading it would conflate two concepts, and it
would leave orphaned variations invisible forever after a parent delete. The
`parent IS NULL` predicate composes correctly with `ON DELETE SET NULL` (§ 2.2).

`assigned` and `default` branches are untouched. A variation reached via
`GET /workouts/:id` behaves exactly like any other workout.

---

## 5. Entitlement

### 5.1 A catalog column, not a tier list

Add `subscription_tiers.loadout_access boolean NOT NULL DEFAULT false`, set
true for `premium_plus` and the three trainer tiers (AC-9.2). This mirrors
`ai_access` exactly and keeps the catalog the single source of truth — a
hardcoded `tierName === "premium_plus"` check in TypeScript would have to be
edited again for B2B seat tiers (M21).

`EntitlementFeature` gains `"loadout"`; `assertEntitlement` routes it to an
`assertLoadout` that clones `assertAiAccess` (`assertEntitlement.ts:424-521`):
profile read → latest `user_subscriptions` LEFT JOIN `subscription_tiers`
selecting `loadoutAccess` → `classifySubscriptionStatus` revert-to-free →
allow on `true` → `buildDenyVerdict` otherwise.

> **Trap:** `assertEntitlement.ts:249-255` is a catch-all
> `if (feature !== "create_workout") return { allowed: true };`. A new feature
> name that is not explicitly routed **silently allows everyone**. The routing
> line and a test that a free user gets 402 are both mandatory.

`EntitlementError` → 402 via `coreErrorHandler`, body already includes
`upgrade_to` and `upgrade_price_monthly` — AC-9.4's "never a hardcoded price"
is satisfied for free, because the price comes from the catalog row.

### 5.2 No taster

There is no free-tier code path, no lifetime pool, no `ai_taster` feature, no
`AI_FREE_TASTER_LIMIT` env var. Comping is a RevenueCat **promotional
entitlement**, which arrives through the normal
webhook → `rcEntitlementToTier` → `user_subscriptions` path and therefore
needs no Loadout-side code at all. `WEBSITE_PRICING_SPEC.md` § 6.1/§ 7 still
carry taster copy; § 1's 2026-07-17 banner supersedes them (noted, not this
spec's to edit).

---

## 6. The substitute ranker (Phase 1, net-new)

### 6.1 Equipment containment

New filter axis on `ListExercisesFilters`:

```ts
equipmentSubsetOf?: string[];   // "everything this exercise needs, I have"
```

```ts
sql`${available}::uuid[] @> COALESCE(${exercises.equipmentRequired}, '{}'::uuid[])`;
```

`COALESCE` is load-bearing: `equipment_required` is nullable on legacy rows
(the `.default([])` was added later) and `@>` against NULL yields NULL, which
would silently drop every legacy row — the same class of bug the repository
already documents for `||` at `exerciseRepository.ts:380-394`.

Note `x @> '{}'` is always true, so **bodyweight exercises pass every context**.
That is correct behaviour, not a bug.

Do **not** overload `equipmentAny` (`&&`, overlap): it means "needs at least one
thing I have", which would return a barbell squat to someone holding a single
dumbbell.

### 6.2 Scoring

Reconciling the orphaned `get_alternative_exercises`
(`002_functions_and_triggers.sql:432`) with GTM § 3 P3:

| Signal                            | Weight           | Source                                            |
| --------------------------------- | ---------------- | ------------------------------------------------- |
| primary-muscle overlap            | hard filter + 50 | orphaned fn (which also hard-filters it)          |
| secondary-muscle overlap          | 20               | orphaned fn (NULL-safe via `COALESCE`)            |
| same `difficulty_level`           | 15               | orphaned fn                                       |
| adjacent `difficulty_level`       | 7                | new — avoids cliff-edge ranking                   |
| same `movement_type` / `category` | 10               | new — a press should prefer a press               |
| caller has logged it before       | 8                | GTM § 3 P3 tiebreak                               |
| equipment                         | **hard filter**  | _diverges from the orphaned fn's +15/−30 scoring_ |
| tiebreak                          | `name ASC`       | FTS precedent (`exerciseRepository.ts:491-566`)   |

**The equipment divergence is the important one.** The orphaned function
_demotes_ incompatible exercises (−30) but still returns them. For an
adaptation that is wrong — an exercise you cannot perform is not a candidate.
The standalone picker (§ 6.4) still wants incompatible rows to render dimmed,
so it asks for both sets explicitly rather than relying on rank order.

**The orphaned SQL function is not reused.** It is dead, untested, references
`profiles.accessibility_needs` and `exercises.is_public` without verification,
and cannot be unit-tested from TypeScript. Its formula is inherited; its
implementation is not. It is left in place (dropping it is out of scope).

### 6.3 Shape

One SQL query per adaptation, not per exercise:

1. Collect the union of primary-muscle ids across every row needing a swap.
2. **One** `select` over `exercises` with: containment filter, primary-muscle
   overlap against that union, the existing `buildVisibilityCondition(userId)`,
   explicit projection, `LIMIT 400`.
3. Score in TypeScript, per source row, as a **pure function**
   `rankSubstitutes(source, candidates, context): RankedCandidate[]`.

This keeps the ranker exhaustively unit-testable without a database, avoids N
round trips, and keeps the visibility predicate in exactly one place. If the
cap truncates (>400 candidates), log it — no silent truncation.

### 6.4 `GET /exercises/substitutes`

`?forExerciseId=&equipment=<uuid>&…` → `{ best: [...], others: [...] }`, where
`best` is containment-passing and ranked and `others` is the same muscle filter
without containment (rendered dimmed by D6). Server-side rather than the
"lean client-side first" option in GTM § 3 P3, because the ranking must respect
`buildVisibilityCondition` — the device's cached library is not visibility-aware
and would leak another coach's private exercises into the picker (AC-3.6).

---

## 7. Adaptation engine (Phase 1)

`POST /workouts/:id/loadout/preview` with `{ savedGymId }` or
`{ equipmentTypeIds }`:

1. Load the parent with `canRead` (`workoutRepository.ts:516`) — own, public,
   friends, or assigned. Not owner-only: AC-1.2.
2. Resolve the equipment context (gym → ids, or direct ids); reject empty (400).
3. Partition rows: `equipment_required ⊆ context` → **KEPT**; else **needs
   swap**.
4. One candidate query (§ 6.3); rank per row; take the top candidate not
   already used elsewhere in the plan (a plan with the same exercise twice is a
   worse plan than a slightly lower-ranked distinct pick).
5. Rows with no candidate → **unresolved**, reason attached (AC-3.4).
6. Return the full ordered plan: per row `{ status: kept|swapped|unresolved,
exerciseId, from?, reason, sets, reps, rest, supersetGroup, sortOrder }`.

Nothing is written. `POST /workouts/:id/variations` takes the reviewed plan
back (the client may have overridden rows) and persists it in one transaction:
insert the variation workout, then its `workout_exercises` with provenance.
The server re-verifies containment and visibility on every submitted row —
the preview response is not trusted on the way back in.

**Reason strings are server-generated and structured**, not free prose:
`{ code: "equipment_unavailable" | "kept_compatible" | "no_candidate" |
"user_override", missingEquipment: [...], matchedOn: [...] }`. The mobile layer
renders copy from the code. This keeps the copy localisable and keeps the
backend free of UI strings.

---

## 8. Equipment scan (Phase 3)

`POST /ai/equipment-scan` — near-clone of `nutritionAiEstimateHandler.ts`,
including its guard order, which is the cost-safety contract:

**auth → entitlement (`loadout`) → daily ceiling → base64 decode → size cap →
magic-byte check → model → parse → validate → 200.**

- `reachedModel` flag + `finally`-block best-effort `AiUsageLogRepository.record()`
  so 402/400/413/429 never consume the ceiling.
- `AI_EQUIPMENT_SCAN_DAILY_LIMIT`, fail-safe parse
  (`Number.isFinite(x) && x > 0`), **default 10/day** — sized against
  Mealprint's checkpoint-3 ceilings (20 suggest / 5 day-plan / 10 swap).
  ⚠ **Brad checkpoint:** confirm 10.
- Register the default in `infra/api.ts`'s environment block alongside the five
  existing `AI_*_DAILY_LIMIT` values. **No IAM change** — the existing
  `bedrock:InvokeModel` wildcards already cover any `eu.anthropic.*` id.
- `AI_EQUIPMENT_SCAN_MODEL_ID`, vision-capable, Haiku-class first (the task is
  far simpler than food estimation).
- Forced tool use returns
  `{ detected: [{ equipmentTypeId | null, label, confidence }], notes }`. The
  full `equipment_types` catalogue (id + name, ~30 rows) goes in the prompt and
  the model must select from it; anything it cannot match comes back
  `equipmentTypeId: null` with a `label` the user can ignore. **Membership is
  re-validated in TypeScript** (§ 1) — a hallucinated uuid is a 422.
- Output is a **draft** (AC-2.3): the user confirms before it becomes context,
  and confirming never implicitly saves a gym.
- `createWithRetry` is usable as-is here (12s × 2 fits the 30s API Gateway
  ceiling). Note for a future model-assisted re-map: GTM § 3 P2 requires ONE
  attempt at a ~20s budget, which needs a no-retry variant of the harness.

---

## 9. P0 — `premium_plus` tier restructure

Shared prerequisite with spec-26 Mealprint. Built once, here.

### 9.1 Migration

`subscription_tiers.tier_name` is **`text` with a unique constraint, not a
Postgres enum** — so there is no `ALTER TYPE … ADD VALUE`, no
transaction-separation dance, just:

```sql
INSERT INTO subscription_tiers (tier_name, display_name, description,
  price_monthly, price_yearly, currency, workout_limit, ai_access,
  ai_workout_limit, gym_buddy_access, …, loadout_access, is_active)
VALUES ('premium_plus', 'Premium+', '…', 29.99, 299.99, 'GBP', NULL, true, …)
ON CONFLICT (tier_name) DO NOTHING;
```

Template: `20260526120000_simplify_tier_model.sql` step 1. Same migration adds
`loadout_access` (§ 5.1) and sets it true for `premium_plus` + the three trainer
tiers.

⚠ `ON CONFLICT DO NOTHING` means **a re-run will not correct a wrong price**.
If the row already exists at the wrong figure, that is a reviewed data op, not
a migration re-run.

### 9.2 Backend registration (each one is required)

1. `assertEntitlement.ts:89-94` — `SubscriptionTierName` union.
2. `assertEntitlement.ts:596-609` — **`coerceTierName`**. Most dangerous
   omission: unlisted names collapse to `"free"`, so a paying Premium+
   subscriber would be reported as free in every 402 verdict.
3. `assertEntitlement.ts:900-914` — `nextTrainerTierUp` (exhaustive switch;
   compile error until handled).
4. `assertEntitlement.ts:642-649` — `pickUpgradeTier`: decide whether a denied
   free user is pointed at `premium` or `premium_plus`. **Feature-dependent** —
   `create_workout` should still say `premium`; `loadout` must say
   `premium_plus`. Take the upgrade target from the feature, not the role alone.
5. `revenuecat/entitlements.ts:16-21` — `RC_ENTITLEMENT_IDS`.
6. `revenuecat/entitlements.ts:28-40` — `rcEntitlementToTier`.
7. `revenuecat/entitlements.ts:47-53` — `TIER_RANK`, renumbered so
   `premium_plus` outranks `premium` (`free 0, premium 1, premium_plus 2,
individual_trainer 3, small_business 4, medium_enterprise 5`). Total `Record`
   → compile error until done. This is what makes precedence work in
   `pickDesiredSubscription`.
8. `subscriptionsCreateHandler.ts:440` — `isUserTier = tierName === "premium"`
   gates trial eligibility; extend to `premium_plus` or Premium+ buyers get no
   trial.

`syncRevenueCatCustomer`, the webhook, `GET /subscriptions/me` and
`GET /subscription-tiers` are all **tier-agnostic** and need no change — but the
catalog row must exist before any `premium_plus` entitlement arrives, or the FK
insert throws → webhook 500 → RevenueCat retry loop.

**RC dashboard:** the entitlement's **lookup_key must literally be
`premium_plus`** — `revenueCatClient.ts:107` reads
`entitlements.items[].lookup_key`, not the product id.

### 9.3 Mobile registration

The GTM brief's "no code-side tier list, verify it degrades gracefully" is
**wrong about today's code**. Both paywalls hardcode the tier:

- `SubscriptionSelectionPresenter.tsx:142` (Stripe rail — dead on iOS but still
  compiled and tested) and `IOSPurchaseFlowPresenter.tsx:120-142` (**the live
  rail**) both do `find(t => t.tierName === "premium")`. A `premium_plus`
  catalog row renders **no card at all** — invisible and unpurchasable.
- `purchaseOfferings.ts:48-65` `tierFromProductId` is a substring ladder; a
  product id containing `premium_plus` matches `"premium"` **first**. The
  `premium_plus` branch must go **above** the `premium` branch — a genuine
  mis-grant bug, not cosmetics.
- `subscriptionService.ts:144` `USER_TRACK_RANK` is a `Partial<Record<…>>`, so
  it does **not** compile-error; an unranked tier makes `tierSatisfies` return
  false and `useAutoRetryOnUpgrade` never unblocks queued sync entries for a
  Premium+ upgrader. Silent.
- Compile-error forcing functions (good): `useFeatureGate.ts:254-258`
  `TRAINER_TIER_LADDER` and the mobile `SubscriptionTierName` union
  (`domain/models/subscription.ts:20-25`).
- Display/styling maps that would render `undefined`:
  `SyncBlockedPresenter:49`, `SyncBlockedBannerMount:22`, `GreetingSection:34`,
  `FeatureGatePrompt:48`, `SubscriptionBadge:42,46,56`,
  `ProfileDrawerPresenter:45,59`, `SubscriptionSuccessContainer:74,94`.

**P0's mobile task is therefore "make the paywall genuinely catalog-driven for
the consumer track"** — iterate the non-trainer catalog rows in tier-rank order
instead of naming `premium` — plus the ladder/rank/map registrations above.

### 9.4 Out of P0's scope

`003_rls_policies.sql:234` and `004_subscriptions_and_roles.sql:417` both carry
a stale `tier_name IN ('basic','premium')` literal (`basic` was deleted in
2026-05). Pre-existing; only the `workout_sharing` legacy RPC reads it and the
V2 app does not call it. Recorded, not fixed here.

---

## 10. Mobile (Phases 2 & 4)

Screens recreate design D7 in the app's existing primitives and tokens
(`BottomSheet`, `Card`, `Btn`, `Pill`, `HeaderBar`, `IconBtn`) — no lifted
prototype code, no raw hex (the `no-raw-hex-colors` lint enforces this), the
container/presenter seam as everywhere else.

| Step       | Screen                                                     | Notes                                                   |
| ---------- | ---------------------------------------------------------- | ------------------------------------------------------- |
| `detail`   | Loadout entry card on workout detail + "Saved setups" list | Locked + upsell sheet when not entitled                 |
| `collect`  | Scan / Pick equipment / reuse a saved gym                  | Equipment groups come from the API, not a constant      |
| `scan`     | Camera → draft-confirm (design D1)                         | `SnapAISheetContainer` transport: ≤1080px, q0.7, base64 |
| `manual`   | Grouped chips + name field + save toggle                   |                                                         |
| `adapting` | Skeleton                                                   | Real request, not a timer                               |
| `review`   | Per-row KEPT/SWAPPED + reason + swap sheet                 | Shared component with D6 (AC-4.4)                       |
| `saved`    | Success                                                    | "your original stays exactly as it was"                 |

Coach mode is the same machine in the trainer tone with programme-level entry
and an assign action (AC-8.3).

**One shared `EquipmentAwareSwapSheet`** replaces the ad-hoc filtering in
`SwapExercisePopover.tsx:131-142` and serves both the standalone swap and the
Loadout review row. Its persistence path is the untouched
`substitute-exercise.command.ts`.

The upsell sheet must read the Premium+ price from the catalog, not the
prototype's hardcoded `£19.99` (now `£29.99`).

---

## 11. Test strategy (≥ 90 %, no fake tests)

**Layer 1 — rendered SQL (`PgDialect`).** The mocked-`getDb` blind spot means
SQL bugs ship green. Mirror `workoutRepository.test.ts:867-905`'s recording
chain for:

- the `mine` branch containing `parent_workout_id IS NULL` (§ 4);
- the containment predicate rendering `@>` with the `COALESCE` wrapper, **not**
  `&&` (§ 6.1) — this test must fail against an `equipmentAny` implementation;
- saved-gym reads/writes rendering `user_id`;
- the variations list rendering both `parent_workout_id` and `created_by`.

Build subqueries with drizzle's connection-free `QueryBuilder` so they render
without a DB, as `exerciseRepository.ts:192-230` does.

**Layer 2 — pure functions.** `rankSubstitutes` is a pure function: exhaustive
cases for every weight, the `name ASC` tiebreak, NULL `secondary_muscles`, NULL
`equipment_required`, empty context, no-candidate.

**Layer 3 — handlers.** 402 for a non-entitled caller on every create path
(including the catch-all trap in § 5.1); 429 + `ai_daily_limit` on the scan;
usage rows written only when `reachedModel`; 409 duplicate gym name; 400
unknown equipment id; 404 for another user's gym/variation.

**Layer 4 — two-user isolation.** Per `requirements.md` § Data-isolation
acceptance. Also: a variation built from a coach-owned parent is invisible to
the coach.

**Layer 5 — model adapter.** Fake `MinimalBedrockClient` (never network,
`aiEstimation.test.ts` pattern); assert the candidate list was actually sent,
the tool was forced, and that a returned id outside the candidate set throws.

---

## 12. Rollout

- Migrations auto-apply to **staging** on merge (`deploy-staging.yml` runs
  `supabase db push` first). **Production apply is MANUAL** — call it out in
  every PR body that carries one.
- Nothing in Phases 0/1 is device-visible; Phases 2–4 need a fresh EAS dev
  build and must not be claimed device-verified without one.
- P0 has an ops half that is **chat-copy, not committed**
  (`feedback_setup_briefs_as_chat_copy`): ASC products at £29.99/£299.99, the
  RevenueCat entitlement with lookup_key `premium_plus`, and attaching both
  products to the `default` offering. The catalog migration must be on
  production **before** the ASC products go live, or the first purchase
  webhook FK-fails.
