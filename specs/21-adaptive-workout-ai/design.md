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
[2] SELECTION  ← the ONLY pluggable stage. DECIDED 2026-07-26 by the
    Phase E2 bake-off (§ 6.0): the HYBRID ships.
    - SHIPPING: deterministic § 6.2 ranking narrows the pool to the top 25
      candidates per row, then model composition (forced tool use, one call
      for the whole plan) chooses `exerciseId` values FROM that shortlist
      only, and writes the per-row reason. Carries a ceiling and a cost
      (~$0.0057/adaptation) — see requirements AC-10.2.
    - REJECTED, deterministic ranker alone: pattern-blind on the data the
      library actually has (§ 6.0). Lost 4-50 on blind preference.
    - REJECTED, model over the full pool: judged-equivalent to the hybrid
      (25-25) at 3.4x the cost.
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

**Stages 1, 3 and 4 stayed deterministic when the hybrid won.** Equipment
containment, read-visibility and the parent's training targets never moved to
the model — the model changes _which exercise is picked_, never _whether the
pick is legal_. That is what made the bake-off a quality question rather than a
safety one, and it is the property spec-26 must preserve when it mirrors this
section.

⚠ **A consequence for anyone mirroring this section: stage 2 is now
model-backed, so the pipeline is no longer free.** E2 measured **zero non-member
ids across 116 model runs and 341 selected ids**, so the parse-failure rule above
guards a rare event rather than a common one — but the ceiling, the usage log and
the async-job requirement for fan-out are all real (requirements AC-10.2 /
AC-10.3, § 7.3).

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
  than a bare column. The installed drizzle-orm (`^0.44.2`) should accept an
  SQL expression in `.on()`, but **no index in this repo does it today** — all
  ~11 `uniqueIndex().on()` calls in `schema.ts` use bare columns — so treat it
  as unverified. If it doesn't work, declare the index in SQL only and comment
  the mirror; the index still exists in the database either way.

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
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workouts_variation_kind_check'
  ) THEN
    ALTER TABLE workouts ADD CONSTRAINT workouts_variation_kind_check
      CHECK (variation_kind IS NULL OR variation_kind IN ('loadout'));
  END IF;
END $$;
```

A bare `ADD CONSTRAINT` is **not** idempotent and fails on re-run — write the
guarded form, not the shorthand.

**`ON DELETE SET NULL` is deliberate.** With § 4's library predicate, deleting a
parent turns its variations into ordinary standalone workouts that reappear in
the owner's library — they are never silently destroyed (AC-5.4), and no
cleanup job is needed. `CASCADE` would delete a user's training history's
worth of variations behind one tap; `RESTRICT` would make parents undeletable.

**A variation is always created `visibility = 'private'`**, never inheriting the
parent's. § 4 only patches the `mine` list branch; the `default` branch is
`visibility = 'public' AND (created_by IS NULL OR created_by != userId)`
(`workoutRepository.ts:487-495`), so a variation of a public parent that
inherited `public` would land in every other user's browse — carrying the
owner's gym kit with it.

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
  ADD COLUMN IF NOT EXISTS substitution_reason jsonb,
  ADD COLUMN IF NOT EXISTS is_user_override boolean NOT NULL DEFAULT false;
```

`substitution_reason` is **`jsonb`, not `text`** — § 7 requires the reason to be
a structured, localisable code (`{ code, missingEquipment, matchedOn }`), and
AC-3.3 requires it to survive into the saved variation. A `text` column would
force JSON-in-string.

`is_user_override` records that the athlete deliberately picked this row
(AC-4.3), which is what lets the save path skip containment re-verification for
it without weakening the check everywhere else (§ 7).

**No new index.** `workout_exercises` looks index-free in `schema.ts`, but
`supabase/migrations/001_initial_schema.sql:699-702` already creates
`idx_workout_exercises_workout`, `idx_workout_exercises_workout_id` (an
already-redundant pair on the same column) and a composite
`(workout_id, superset_group)`. `CREATE INDEX IF NOT EXISTS` matches on **name**,
not definition, so adding a differently-named index would silently create a
third duplicate on a hot write path. Mirror the existing indexes into
`schema.ts` instead; tidying the redundant pair is out of scope.

Swap count is **derived** (`count(substituted_from_exercise_id)`), so it can
never drift from the rows. The reason survives into the saved variation, which
is what makes a two-week-old variation legible.

### 2.3b `equipment_types.category`

AC-2.2 requires the manual picker to be grouped by category from the API rather
than a hardcoded client list, and `equipment_types` has **no category column**
today (`id, name, description, created_at` — sibling reference tables
`accessibility_tags` and `goal_types` both do have one).

```sql
ALTER TABLE equipment_types
  ADD COLUMN IF NOT EXISTS category text;
```

Backfill the 28 seeded rows with an explicit idempotent
`UPDATE … WHERE category IS NULL` (two-way idempotent: a re-run is a no-op AND
a hand-recategorised row is never stomped), and extend
`GET /exercises/equipment` to project it (nullable — an uncategorised row
renders under "Other" rather than disappearing).

**SIX groups, not five** (Brad, 2026-07-26 — this supersedes the original
"free weights / machines / cables / bodyweight / cardio"):

| Category       | Seeded rows                                                              |
| -------------- | ------------------------------------------------------------------------ |
| `free_weights` | Barbell, Dumbbells, Kettlebell, EZ Bar, Medicine Ball, Bench, Squat Rack |
| `machines`     | Smith Machine, Leg Press / Leg Curl / Leg Extension Machine              |
| `cables`       | Cable Machine, Lat Pulldown Machine                                      |
| `bodyweight`   | Bodyweight, Pull-up Bar, Dip Station, TRX / Suspension Trainer, Ab Wheel |
| `cardio`       | Rowing Machine, Treadmill, Exercise Bike, Elliptical                     |
| `accessories`  | Resistance Bands, Foam Roller, Yoga Mat, Box / Step, Battle Ropes, Sled  |

The five original groups leave six rows homeless, **including Resistance
Bands** — and "bands only" is one of the four canonical equipment contexts the
Phase-E2 bake-off measures against (`requirements.md` § Eval spike), so bands
falling into "Other" would be a visible hole in the picker rather than a tidy-up
detail. `accessories` is the sixth group. The bench and the squat rack sit with
the free weights because that is the kit you use them _with_ — the picker is
grouped the way a gym-goer reads it, not the way a taxonomist would.

Each name is claimed by **exactly one** group. Claiming a name twice would make
the grouping depend on statement order, because the second `UPDATE`'s
`category IS NULL` guard would silently skip it — asserted by test.

**This lands in Phase 0, not Phase 2.** It is only consumed by the mobile
picker, but deferring it would force an out-of-phase migration after the Phase-0
migration window has closed.

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

All mounted in a **new `loadoutRoutes.ts` sub-app**, not on the root chain —
with one deliberate exception (`GET /exercises/substitutes`, below). The root
`.use()` chain in `api.ts` is at TS's instantiation-depth ceiling — spec-25 hit
TS2589 there and had to nest. Precedent sub-apps mount late:
`subscriptionsRoutes` (`api.ts:181`), `trainersOnBehalfRoutes` (`:236`),
`nutritionRoutes` (`:240`).

| Method   | Path                            | Phase | Guard                                 | Notes                                                |
| -------- | ------------------------------- | ----- | ------------------------------------- | ---------------------------------------------------- |
| `GET`    | `/saved-gyms`                   | 0     | auth                                  | caller's gyms, newest first                          |
| `POST`   | `/saved-gyms`                   | 0     | auth                                  | 409 on duplicate name; 400 on unknown equipment id   |
| `PATCH`  | `/saved-gyms/:id`               | 0     | auth + ownership                      | name and/or equipment                                |
| `DELETE` | `/saved-gyms/:id`               | 0     | auth + ownership                      | variations survive (`source_gym_id` → NULL)          |
| `GET`    | `/workouts/:id/variations`      | 0     | auth + parent read                    | caller-owned variations of that parent               |
| `POST`   | `/workouts/:id/variations`      | 0     | auth + parent `canRead` + **loadout** | persist a reviewed adaptation; 402 when not entitled |
| `POST`   | `/workouts/:id/loadout/preview` | 1     | auth + **loadout**                    | compute, persist nothing                             |
| `POST`   | `/ai/equipment-scan`            | 3     | auth + **loadout**                    | + daily ceiling (§ 8)                                |
| `GET`    | `/exercises/substitutes`        | 1     | auth                                  | ranked picker feed (§ 6.4)                           |

Route-ordering: the `/saved-gyms/*`, `/workouts/:id/variations` and
`/workouts/:id/loadout/preview` paths sit under distinct prefixes or at a
deeper segment count, so none collides with the `/workouts/:id` matcher, and
`loadoutRoutes` can mount late like its precedents.

**`GET /exercises/substitutes` is the exception and does not live in
`loadoutRoutes`.** It must be registered **before `exercisesGetHandler`**
(`api.ts:122`) or the `/exercises/:id` matcher captures `substitutes` as a
literal id — the trap `api.ts:119-121` documents for `exercisesSearchHandler`.
A late-mounting sub-app cannot satisfy that. Ship it as its own handler mounted
immediately next to `exercisesSearchHandler`, and add it to the existing
route-ordering test (`application/__tests__/trainersOnBehalfRouteOrdering.test.ts`
is the precedent).

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
separate `SELECT` first (`workoutRepository.ts:398-401`: _"no separate SELECT,
no TOCTOU window"_), and a zero-row result is a **404**, with no 403/404
distinction.

---

## 4. Library pollution

`workoutRepository.buildListWhereClause` (L446) has **two** `mine` paths, and
neither excludes variations:

```ts
return ownerLibraryOnly
  ? and(eq(workouts.createdBy, userId), eq(workouts.showInOwnerLibrary, true)) // L458-462
  : eq(workouts.createdBy, userId); // L463
```

Four Loadout variations would become four extra cards in "My Workouts".

Fix: add `isNull(workouts.parentWorkoutId)` to **both** `mine` paths. Patching
only the second leaves trainers — who call with `ownerLibraryOnly: true` — still
seeing every variation.

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

### 6.0 E2 verdict — the ranker is the SHORTLISTER, not the chooser (2026-07-26)

**D7 is decided by the Phase E2 bake-off. Phase 1 builds the HYBRID:
deterministic shortlist → model selection → model reasons.** Full evidence:
`scratchpad/loadout-phase-e/VERDICT-E2.md`; raw dataset in that directory's
`results/`.

20 workouts × 4 contexts = 80 fixtures, **58 of which bear a swap** (171 rows),
identical candidate sets, blind scoring by a model that was not one of the arms.
Fidelity, cost and latency are over the swap-bearing fixtures; the verdict's
§ Results carries the caveats, including that the equipment-legal row is
structurally guaranteed by stages 1 and 3 rather than a gate an arm could fail.

|                                    | Arm A — ranker only       | Arm B — model, full pool | **Arm C — hybrid**  |
| ---------------------------------- | ------------------------- | ------------------------ | ------------------- |
| Equipment-legal plans (see caveat) | 80/80                     | 80/80                    | 80/80               |
| Mean primary-muscle fidelity       | 0.968                     | 0.822                    | 0.930               |
| Pattern fidelity (blind, 1–5)      | 3.07 / 2.98               | 4.43                     | **4.07 / 4.28**     |
| Whole-plan coherence (blind)       | 3.21 / 3.16               | 4.10                     | **3.93 / 4.07**     |
| Reason quality (blind)             | 2.62 / 2.69               | 4.02                     | **3.81 / 4.07**     |
| Head-to-head preference            | lost 5–52 to B, 4–50 to C | 25–25 vs C               | ties B, beats A     |
| Cost per adaptation                | $0                        | $0.0199                  | **$0.0057**         |
| p50 / max latency                  | 0.1 ms                    | 2.85 s / 4.07 s          | **2.60 s / 3.79 s** |

Three consequences for the sections below:

1. **§ 6.2's scoring stays, as the shortlister.** T-1.2 is still Phase-1 work —
   the top 25 ranked candidates per row are what the model chooses from. Ranking
   303 candidates down to 56 is where 71 % of arm B's cost went, at no measured
   quality cost (25–25, ±0.1 on two of three axes).
2. **§ 6.2's `movement_type` signal has no data behind it.** `movement_type` is
   **NULL for all 2281 seeded rows** — only `exercisesCreateHandler` /
   `exercisesUpdateHandler` ever write it, for user-created exercises — so the
   10-point signal degrades to `category`, which is `strength` for 1976/2281
   rows. This is _why_ arm A was pattern-blind, producing equipment-legal but
   unshippable swaps (Barbell Deadlift → **Atlas Stones** in a bands-only
   context; Machine Bicep Curl → **Floor Rope Climb**). A deterministic-only
   engine would first need `movement_type` backfilled across the catalogue — a
   separate data workstream, not a Phase-1 task.
3. **A model is now on the re-map path**, so § 7.3's sizing and `AC-10.2` change
   — see § 7.3's 2026-07-26 note and `requirements.md` US-10.

⚠ **Live data bug found by the eval, unrelated to either arm.** `Leg Press` and
`Leg Curl` resolve to `equipment_required = '{}'` because their seeded equipment
names have no `equipment_types` row (`Leg Press Machine` / `Leg Curl Machine`) and
`seedExercises.ts`'s `resolve()` drops unmapped names silently. Since `x @> '{}'`
is always true (§ 6.1), a bands-only athlete **keeps the leg press** — in the
seeded "Lower Body" and "Full Body Starter" workouts, i.e. the first workouts a
new account owns. Fix is a data migration plus a seeder guard that fails loudly;
not an engine change.

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

| Signal                            | Weight           | Source                                                                                                             |
| --------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| primary-muscle overlap            | hard filter + 50 | orphaned fn (which also hard-filters it)                                                                           |
| secondary-muscle overlap          | 20               | orphaned fn (NULL-safe via `COALESCE`)                                                                             |
| same `difficulty_level`           | 15               | orphaned fn                                                                                                        |
| adjacent `difficulty_level`       | 7                | new — avoids cliff-edge ranking                                                                                    |
| same `movement_type` / `category` | 10               | new — a press should prefer a press (⚠ § 6.0: `movement_type` is NULL library-wide, so this reduces to `category`) |
| caller has logged it before       | 8                | GTM § 3 P3 tiebreak                                                                                                |
| equipment                         | **hard filter**  | _diverges from the orphaned fn's +15/−30 scoring_                                                                  |
| tiebreak                          | `name ASC`       | FTS precedent (`exerciseRepository.ts:491-566`)                                                                    |

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
3. **One** lookup of the caller's previously-logged exercise ids (a `DISTINCT
exercise_id` over their session-exercise history, intersected with the
   candidate ids) — this is the data source for the "logged before" signal,
   which otherwise has none.
4. Score in TypeScript, per source row, as a **pure function**:

```ts
rankSubstitutes(
  source: SourceExercise,
  candidates: CandidateExercise[],
  context: { equipmentTypeIds: string[]; loggedExerciseIds: ReadonlySet<string> },
): RankedCandidate[];
```

This keeps the ranker exhaustively unit-testable without a database, avoids N
round trips, and keeps the visibility predicate in exactly one place. Both
queries are independent and can run concurrently. If the cap truncates (>400
candidates), log it — no silent truncation.

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
The preview response is **not** trusted on the way back in.

### 7.1 What the save path re-verifies

Two different checks, with deliberately different scope:

| Check                        | Applies to                              | On failure |
| ---------------------------- | --------------------------------------- | ---------- |
| Exercise **read-visibility** | **every** submitted row                 | 403 / 400  |
| Equipment **containment**    | rows **not** flagged as a user override | 400        |

The asymmetry is required by AC-4.2 and AC-4.3: the athlete may deliberately
pick an incompatible exercise from the full library after an explicit
"doesn't fit your kit" acknowledgement. Re-verifying containment on _every_
row would reject exactly the case the ACs mandate — and the design already
mints a `user_override` reason code for it. Visibility, by contrast, is a
data-isolation control and is never negotiable: an override cannot be used to
smuggle in another coach's private exercise.

The override is persisted as `workout_exercises.is_user_override` (§ 2.3) so
the variation can explain itself later. Note that **on the create path the flag
is a client-supplied claim** — the row does not exist yet — so a client could
set it on every row and skip containment wholesale. That is acceptable
precisely because containment is a _quality_ check, not a security control:
visibility, which is the security control, is re-verified on every row
regardless. Do not later reuse `is_user_override` as a server-attested fact for
a gate where it would matter.

### 7.2 Reasons

**Server-generated and structured**, not free prose:
`{ code: "equipment_unavailable" | "kept_compatible" | "no_candidate" |
"user_override", missingEquipment: [...], matchedOn: [...] }`, stored in the
`substitution_reason` **jsonb** column. The mobile layer renders copy from the
code. This keeps copy localisable and the backend free of UI strings.

### 7.3 Sizing

> **⚠ REVISED 2026-07-26 by the E2 verdict (§ 6.0).** The premise below — "no
> model call" — no longer holds: stage 2 is model-backed. Measured on 58
> swap-bearing fixtures, a **single-workout** adaptation is p50 2.60 s / max
> 3.79 s, so it stays comfortably inside both the 30 s API Gateway ceiling and
> `createWithRetry`'s 12 s × 2 budget — the paragraph below still reads correctly
> for the single-workout case, just for a different reason.
>
> **Programme-level (Phase 4) must now go async.** At 2.60 s per workout the
> 120-workout cap is ~5 minutes of model time, and even a 12-week × 4-session
> programme (~48 workouts) is ~2 minutes. **The sentence further down saying the
> 30 s ceiling "does not bind here" is now wrong for the programme case.** The
> async-job model is required, and it is the **same infrastructure spec-26
> Mealprint needs** for week plans and programme import — whichever spec reaches
> it first builds it; it must not be built twice. Cost at the cap is ~$0.67 per
> programme adaptation.

An adaptation is **pure SQL plus in-memory scoring** — no model call, no
network hop per exercise — so a single workout is comfortably inside the
request budget.

**Programme-level (Phase 4) is where this needs a bound.** A 12-week ×
4-sessions programme is ~48 workouts. The candidate pool is still assembled
**once** for the union of _all_ muscles across the programme and reused for every
workout, so stage 1 stays cheap — **but stage 2 is now one model call per
workout**, so the work is linear in WORKOUTS, not just in
`workout_exercises` rows. Revised bound:

- Cap a single programme adaptation at **120 workouts**; beyond that return 413
  with a message to adapt the programme in parts. No silent truncation.
  ⚠ **Brad checkpoint:** confirm 120 — and note the case for it changed. It is
  no longer "the cost analysis does not justify a tighter bound": 120 workouts is
  **120 model calls, ~5 minutes of model time and ~$0.69** (E2 measured, § 6.0).
  A tighter bound would still trip on ordinary blocks (12 weeks × 5 sessions is
  60, a 13-week cycle is 52), so the argument for 120 survives — but it now rests
  on user-facing coverage, not on the work being nearly free.
- ~~The 30s API Gateway ceiling that constrains § 8 does **not** bind here,
  because nothing calls Bedrock.~~ **It binds now.** Stage 2 calls Bedrock, so
  the programme case **must** use the async-job model — this is the point at which
  Loadout needs the same job infrastructure Mealprint's week plans and programme
  import need, and **it must not be built twice** (requirements AC-10.3).

---

## 8. Equipment scan (Phase 3)

### 8.0 E1 status — BLOCKED, no verdict yet (2026-07-26)

**There is no E1 accuracy figure, because E1 has not run.** T-E1.1 needs ~30 real
gym photos (commercial floor, hotel gym, home garage, bands-only) and those are
Brad's to supply. Stock images were **deliberately not substituted** — E1 exists
to measure real-world accuracy on phone photos, so a number derived from clean
product shots would be worse than no number: it would read as evidence.

Consequently the two decisions E1 was sequenced to make are still open:

- **Whether scan is the primary collect path**, an accelerator alongside the
  picklist, or not shipped. `requirements.md` § Eval spike sets the exit
  criteria; **AC-2.3 and the Phase-2 collect-step design must not be built
  around scan-as-primary until E1 returns a figure.**
- **The daily ceiling** (§ 8's proposed default of 10) — still a Claude proposal,
  not a Brad decision.

Phase 2 can proceed on the saved-gym and manual-picklist paths meanwhile; those
are unblocked and are the paths that must work regardless of E1's outcome.

What E2 did establish that transfers: the candidate-constrained contract holds in
practice. Across **116 model runs that selected 341 ids**, **zero non-member ids**
were returned —
so § 1's "a hallucinated uuid is a 422" is a guard against a rare event, not a
common one, and the same membership-validation shape is right for the scan
(T-3.3). Haiku-class was sufficient for selection, supporting the
Haiku-class-first choice below.

### 8.1 Endpoint

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
  ceiling). **The model-assisted re-map is no longer hypothetical — it ships
  (§ 6.0) — so resolve the no-retry question in Phase 1, not later:** GTM § 3 P2
  asks for ONE attempt at a ~20s budget because a retry on a large generation
  doubles cost and leaves no headroom inside 30s. E2 measured the happy path at
  2.60s p50 / 3.79s max, so `createWithRetry` as-is is fine **when the first
  attempt succeeds**; the open question is only the retry path, where 12s × 2 plus
  auth, SQL and usage-log overhead is uncomfortably close to the ceiling. Decide
  in T-1.9 whether the re-map takes the retry or a single ~20s attempt.

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

**Seed the row `is_active = false`.** This is the single most important value
in the migration. `SubscriptionTiersRepository.listActive()` filters on
`is_active`, and § 9.3's catalog-driven paywall renders **every** active
non-trainer row — so an active row publishes a buyable £29.99/mo card the
moment the migration lands, selling a tier whose only differentiator does not
exist yet. Either the buyer taps a dead end, or (once the ASC products from
§ 12 exist) they pay 2.3× Premium and receive Premium. The marketing site
already says "Coming soon".

The row still **exists**, which is what correctness needs: the
`user_subscriptions.tier_name` FK resolves, so a RevenueCat promotional
entitlement can be granted and synced before launch without the webhook
FK-failing into a retry loop.

**Launch is then a one-line data op** —
`UPDATE subscription_tiers SET is_active = true WHERE tier_name =
'premium_plus';` — shipped as its own migration with the Loadout release,
once Phase 2 is device-verified.

**Do not read the catalog with a bare `select()`.** `listActive()` backs a
public, unauthenticated endpoint; a bare select emits every column named in
`schema.ts`, so a Lambda deployed before the hand-applied production migration
throws Postgres 42703 and shows every user "Failed to Load Subscription
Options". Project explicitly, and leave `loadout_access` out until something
reads it.

### 9.2 Backend registration (each one is required)

1. `assertEntitlement.ts:89-94` — `SubscriptionTierName` union.
2. `assertEntitlement.ts:596-609` — **`coerceTierName`**. Most dangerous
   omission: unlisted names collapse to `"free"`, so a paying Premium+
   subscriber would be reported as free in every 402 verdict.
3. `assertEntitlement.ts:900-914` — `nextTrainerTierUp` (exhaustive switch;
   compile error until handled).
4. `assertEntitlement.ts:642-649` — `pickUpgradeTier` must eventually be
   **feature-dependent**: `create_workout` keeps pointing at `premium`, while a
   `loadout` denial must point at `premium_plus`. **This belongs in Phase 0, not
   P0.** `loadout` does not exist as an `EntitlementFeature` until Phase 0
   (T-0.8), so building the seam in P0 ships a branch that cannot execute and a
   coverage suppression to hide it. Add the parameter, the
   Premium+-only feature set and the branch together with `loadout` itself,
   where all three are reachable and testable in one change.
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
- `purchaseOfferings.ts:48-63` `tierFromProductId` is a `.toLowerCase()` +
  sequential `.includes()` ladder. There is no `premium_plus` branch today, so a
  `…premium_plus…` product id falls into the `premium` branch and **grants the
  wrong tier**. The new branch must be inserted **above** `premium` — a genuine
  mis-grant bug, not cosmetics. (Note the ladder already tests `enterprise` and
  `business` before `premium`, so ordering discipline is the established
  convention here, not a new idea.)

**The genuinely silent failures are only two.** Most of the tier maps are
_total_ `Record<SubscriptionTierName, …>` types or exhaustive switches, so they
**fail the build** on a new union member — which is the behaviour we want:

- Compile-error forcing functions (good, no action needed beyond fixing the
  errors): the mobile `SubscriptionTierName` union
  (`domain/models/subscription.ts:20-25`), `useFeatureGate.ts:250`
  `TRAINER_TIER_LADDER`, `SyncBlockedPresenter:49`, `SyncBlockedBannerMount:22`,
  `FeatureGatePrompt:48`, `SubscriptionBadge:44` (the `TIER_DISPLAY_NAMES`
  Record only — see below), `ProfileDrawerPresenter:41,55` (exhaustive
  switches, no `default`), and
  `SubscriptionSuccessContainer:72` — whose in-code comment says it exists
  _specifically_ to force this compile error.
- **Silent 1** — `subscriptionService.ts:140` `USER_TRACK_RANK` is
  `Partial<Record<…>>`, so it does not compile-error; an unranked tier makes
  `tierSatisfies` return false and `useAutoRetryOnUpgrade` never unblocks queued
  sync entries for a Premium+ upgrader.
- **Silent 2** — `useFeatureGate.ts:106` `USER_UPGRADE_CHAIN` is also `Partial`,
  in the same file where `TRAINER_TIER_LADDER` is total. Same file, opposite
  safety.
- **Silent 3** — `SubscriptionBadge.tsx:52-63` `variantFor` is a switch **with a
  `default: return "trainer"`**. The total Record two lines above it _does_
  compile-error, so a developer lands in the file — but fixing that error does
  not fix `variantFor`, and Premium+ would render in the violet trainer palette.
  Treat `premium_plus` like `premium` here.
- **Silent 4** — `subscriptionService.ts:115-127` `shouldShowTrialBanner` falls
  through to `return false` for any tier that is neither `premium` nor a trainer
  tier, so a Premium+ buyer sees no trial banner — a direct AC-11.6 miss.
- `GreetingSection.tsx:32` is loosely typed but has a `|| "Free"` fallback
  (L58), so it degrades to the wrong label rather than `undefined`.

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

| Step       | Screen                                                     | Notes                                                               |
| ---------- | ---------------------------------------------------------- | ------------------------------------------------------------------- |
| `detail`   | Loadout entry card on workout detail + "Saved setups" list | Locked + upsell sheet when not entitled                             |
| `collect`  | Scan / Pick equipment / reuse a saved gym                  | Equipment groups come from the API, not a constant                  |
| `scan`     | Camera → draft-confirm (design D1)                         | `SnapAISheetContainer` transport: resize + q0.7 + base64 (see note) |
| `manual`   | Grouped chips + name field + save toggle                   |                                                                     |
| `adapting` | Skeleton                                                   | Real request, not a timer                                           |
| `review`   | Per-row KEPT/SWAPPED + reason + swap sheet                 | Shared component with D6 (AC-4.4)                                   |
| `saved`    | Success                                                    | "your original stays exactly as it was"                             |

Coach mode is the same machine in the trainer tone with programme-level entry
and an assign action (AC-8.3).

> **Payload-size note.** `SnapAISheetContainer.tsx:119` resizes with
> `[{ resize: { width: MAX_DIMENSION } }]` — **width only**, despite its own doc
> comment (L21) saying "long edge". A portrait photo therefore still exceeds
> 1080 on the height axis, and a small image is upscaled. Budget the Phase-3
> payload against that reality, or fix the transport (a shared fix would also
> help Snap AI).

**One shared `EquipmentAwareSwapSheet`** replaces the ad-hoc filtering in
`SwapExercisePopover.tsx:131-142` (whose header comment at L17-19 documents the
gap: _"V2 has no `similar_to` API"_) and serves both the standalone swap and the
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
