# 03 — Exercise Library: Technical Design

## Domain Model

```typescript
// src/domain/models/exercise.ts
export interface Exercise {
  id: string;
  name: string;
  description: string | null;
  instructions: string | null;
  category: ExerciseCategory;
  difficulty: ExerciseDifficulty;
  primaryMuscleGroups: MuscleGroup[];
  secondaryMuscleGroups: MuscleGroup[];
  equipment: EquipmentType[];
  accessibilityTags: AccessibilityTag[];
  isCustom: boolean;
  createdBy: string | null; // userId for custom exercises
}

export type ExerciseCategory =
  | "strength"
  | "cardio"
  | "flexibility"
  | "balance"
  | "plyometric"
  | "olympic"
  | "mobility";
export type ExerciseDifficulty =
  | "beginner"
  | "intermediate"
  | "advanced"
  | "expert";
export type MuscleGroup =
  | "chest"
  | "back"
  | "shoulders"
  | "biceps"
  | "triceps"
  | "quadriceps"
  | "hamstrings"
  | "glutes"
  | "calves"
  | "core"
  | "forearms"
  | "traps"
  | "lats"
  | "hip_flexors"
  | "abductors"
  | "adductors";
export type EquipmentType =
  | "barbell"
  | "dumbbell"
  | "machine"
  | "cable"
  | "bodyweight"
  | "kettlebell"
  | "resistance_band"
  | "smith_machine"
  | "ez_bar"
  | "other";

export interface ExerciseFilters {
  search?: string;
  muscleGroups?: MuscleGroup[];
  equipment?: EquipmentType[];
  category?: ExerciseCategory;
  difficulty?: ExerciseDifficulty;
}
```

## Port Extensions

```typescript
// Extends ApiPort
getExercises(filters?: ExerciseFilters, cursor?: string): Promise<Result<PaginatedResult<Exercise>, ApiError>>;
getExercise(id: string): Promise<Result<Exercise, ApiError>>;
createExercise(data: CreateExerciseInput): Promise<Result<Exercise, ApiError>>;

// Extends StoragePort
getCachedExercises(filters?: ExerciseFilters): Promise<Exercise[]>;
cacheExercises(exercises: Exercise[]): Promise<void>;
getExerciseCacheAge(): Promise<Date | null>;
saveCustomExercise(exercise: Exercise): Promise<void>;
```

## Application Layer

```typescript
// src/application/queries/exercises.query.ts
// - Reads from local cache first
// - If online and cache stale (>24h), fetches from API and updates cache
// - Applies filters locally for instant response

// src/application/commands/create-exercise.command.ts
// - Validates input
// - Saves to local storage
// - Queues API sync mutation
```

## UI Layer

```
ui/containers/ExerciseListContainer.tsx    # Fetches, filters, search state
ui/presenters/ExerciseListPresenter.tsx    # Renders list + filters
ui/containers/ExerciseDetailContainer.tsx  # Fetches single exercise
ui/presenters/ExerciseDetailPresenter.tsx  # Renders detail view
ui/containers/ExerciseCreatorContainer.tsx # Form state, validation
ui/presenters/ExerciseCreatorPresenter.tsx # Form UI
ui/components/ExerciseCard.tsx             # List item presenter
ui/components/ExerciseFilterBar.tsx        # Filter chips presenter
ui/components/MuscleGroupPicker.tsx        # Multi-select muscle groups
```

## Offline Strategy

- **Initial sync**: On first launch (or after cache clear), fetch full exercise library
- **Incremental sync**: On subsequent launches, fetch updated exercises since last sync
- **Custom exercises**: Created locally, synced on next online window
- **Cache invalidation**: Stale after 24 hours, refresh in background
- **Search**: Local full-text search on cached name + description fields

---

## Backend Endpoints (added M0)

The SST backend owns all exercise-data endpoints. Legacy `persistence-mobile` talked directly to Supabase with RLS; V2 routes all queries through explicit handlers with explicit authorization. Request/response wire format matches the legacy Supabase shape so ported presenters work unchanged.

### Wire format conventions

- Request/response bodies use **snake_case** field names (matches legacy Supabase column shape).
- Query params use **repeated-key arrays** for multi-value filters (e.g. `?created_by=mine&created_by=system`) — matches legacy client.
- UUIDs for all reference-entity references (`muscle_groups`, `equipment_types`); enum strings for category/difficulty/created-by.
- Standard response envelope: `{ data: T | T[], meta?: { total, offset, limit } }`.

### Reference-list endpoints (existing — shape documented)

- `GET /exercises/muscle-groups` → `{ data: [{ id: uuid, name: string, display_name: string }] }`
- `GET /exercises/equipment` → `{ data: [{ id: uuid, name: string, display_name: string | null }] }`
  - The `equipment_types` table has no `display_name` column today; the handler emits `display_name: null` for consistency. Mobile falls back to `name` in the UI.
- `GET /exercises/categories` → **M0 shim**: continues to return `{ data: string[] }` (distinct enum values). Mobile adapter maps `string[] → ReferenceEntry` client-side for M0. A real `categories` reference table is deferred to a later milestone.

No shape changes to the three reference-list endpoints in M0. Shape is pinned here as the shared contract with mobile.

### `GET /exercises` (extended)

Extended filter schema (supersedes existing schema):

```ts
query: t.Object({
  q:                     t.Optional(t.String()),       // search
  category:              t.Optional(t.Array(t.String())),        // enum[]
  difficulty_level:      t.Optional(t.Array(t.String())),        // enum[]
  targeted_muscles_any:  t.Optional(t.Array(t.String({ format: "uuid" }))),
  equipment_any:         t.Optional(t.Array(t.String({ format: "uuid" }))),
  created_by:            t.Optional(t.Array(t.String())),        // "mine"|"system"|"pt"|"physio"|"all"
  limit:                 t.Optional(t.Numeric()),
  offset:                t.Optional(t.Numeric()),
}),
```

Filter semantics:

- Within a single axis (e.g. `targeted_muscles_any`): OR match (uses Drizzle `inArray` / array-overlap).
- Across axes: AND match.
- `created_by[]` values are enum strings, NOT UUIDs — backend translates each value into a visibility predicate (see § Backend Authorization Rules). Mixing values is allowed: `?created_by=mine&created_by=system` returns the union.
- `q` performs case-insensitive search over `name + description + instructions`. Legacy used Algolia; V2 uses Postgres full-text (no Algolia in M0 — offline-first and latency parity).

The handler-level **visibility predicate is always applied**, independent of the `created_by` filter. The `created_by[]` filter narrows within the visible set; it cannot expand it.

Pagination is offset/limit. Response:

```json
{ "data": [ApiExercise, ...], "meta": { "total": 123, "offset": 0, "limit": 50 } }
```

### `GET /exercises/:id`

Owner / visibility rules identical to list. Returns 404 if the exercise does not exist **or** the caller cannot see it (no 403; no existence leak). Response `{ data: ApiExercise }`.

### `POST /exercises`

- Auth required (`requireAuth`).
- `created_by` = JWT `sub` (never trusted from the request body).
- Request body — matches legacy `CreateExerciseRequest`:
  ```
  { name, description?, instructions?, video_url?, thumbnail_url?,
    category?, difficulty_level?,
    primary_muscles?: uuid[], secondary_muscles?: uuid[],
    equipment_required?: uuid[],
    accessibility_requirements?: uuid[], accessibility_modifications?,
    region_type?, movement_type?, is_public? }
  ```
- Response `201 { data: ApiExercise }` with server-assigned `id` and `created_by` = caller's id.
- Validation: `name` required (2–100 chars); enums validated; UUID arrays validated.
- `is_public` defaults to `false` for user-created exercises (user customs are private to the visibility graph).

### `PATCH /exercises/:id`

- Auth required.
- Owner-only: `created_by === sub`. Non-owner → **404** (not 403) to avoid leaking existence of other users' customs.
- Non-existent → 404.
- All body fields optional; only sent fields are updated. Same field shape as POST.
- Response `200 { data: ApiExercise }`.

### `DELETE /exercises/:id`

- Auth required.
- Owner-only; same 404-not-403 policy.
- **Hard delete** (no `deleted_at` column; no soft-delete in M0).
- Response `204 No Content`.

---

## Backend Authorization Rules (added M0)

### Visibility predicate (always applied on `GET /exercises` list + detail)

A user can see an exercise row iff **any** of the following is true:

1. `exercises.created_by IS NULL` — system-authored exercises (seeded / administrative). V2 convention: system exercises have no creator FK. There is no magic `SYSTEM_USER_ID` — null means system.
2. `exercises.created_by = <caller's sub>` — the caller's own customs.
3. `exercises.created_by IN (SELECT trainer_id FROM pt_client_relationships WHERE client_id = <caller's sub> AND status = 'active' AND is_ai_trainer = false)` — customs authored by an active PT/physio the caller is connected to.

Unauthenticated callers see only (1). `isPublic = true` is no longer the sole gate — the column remains in the schema but the visibility rule above governs reads.

### `created_by[]` filter translation

Each enum value in the `created_by[]` filter maps to a subquery applied in addition to the visibility predicate (OR-combined within the filter; AND-combined with other axes):

| Filter value | Predicate                                                                                                                                                            | Auth required? |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `"mine"`     | `created_by = sub`                                                                                                                                                   | Yes            |
| `"system"`   | `created_by IS NULL`                                                                                                                                                 | No             |
| `"pt"`       | `created_by IN (active trainer_ids for sub from pt_client_relationships, is_ai_trainer=false)`                                                                       | Yes            |
| `"physio"`   | Same subquery as `"pt"` in M0 — physio role distinction is a later milestone. Documented limitation: `"physio"` returns the same rows as `"pt"` until role is split. | Yes            |
| `"all"`      | No additional constraint (visibility predicate alone).                                                                                                               | No             |

If the filter includes `"mine"`, `"pt"`, or `"physio"` without a valid JWT, return `400 { error: "created_by filter value requires authentication" }`.

### Write handler ownership

- `POST /exercises`: auth required; `created_by` forced to `sub`.
- `PATCH /exercises/:id`: auth required; load row, if `created_by !== sub` return 404.
- `DELETE /exercises/:id`: auth required; same 404-not-403 rule.

---

## Backend Data Model Notes (added M0)

M0 ships **no schema migrations**. All tables and columns referenced above already exist in `packages/db/src/schema.ts` as of 2026-04-19:

- `exercises` — uses `createdBy` (nullable uuid FK → `profiles.id`), `isPublic`, `videoUrl`, `thumbnailUrl`, `primaryMuscles`/`secondaryMuscles`/`equipmentRequired` (uuid arrays), `regionType`, `movementType`, `accessibilityRequirements` (uuid array), `accessibilityModifications`, `category` enum, `difficultyLevel` enum. No `is_custom` column — `isCustom` is derived client-side as `createdBy !== null`.
- `pt_client_relationships` — `trainerId`, `clientId`, `status` (enum: pending/active/inactive/terminated), `isAiTrainer`. Provides the visibility JOIN source.
- `muscle_groups` — `id`, `name`, `description`, `display_name`. Seeded.
- `equipment_types` — `id`, `name`, `description`. **No `display_name` column** (see § Reference-list endpoints). Seeded.
- `muscleCategories` + `muscleGroupCategories` — present but unused by M0.

### Field naming: domain camelCase ↔ wire snake_case

Drizzle schema uses `camelCase` identifiers; wire format uses `snake_case` (matches legacy). Mapping happens at the handler boundary (request parse + response serialize). Mobile's `SSTApiAdapter` has matching mappers (`mapApiExerciseToDomain`, `mapCreateExerciseInputToApi`) — those are the shared contract between tracks.

### System exercise convention

V2 represents system-authored exercises as `exercises.created_by = NULL` (the column is already nullable). No reserved UUID, no service account. This is a deliberate deviation from legacy's `SYSTEM_USER_ID = '00000000-...'` Supabase pattern — the V2 backend owns authorization explicitly and doesn't need a sentinel FK.

---

## Reference-List Cache (added M0, frontend track)

Mobile holds a translation layer between its string enums and the backend's UUID catalog. The cache is offline-first, reused across features (goal types, measurement types, exercise taxonomies), and is the foundation M0's filter wire-format fix depends on.

### Domain model — `packages/mobile/src/domain/models/reference-list.ts`

```ts
export type ReferenceListKind = "muscle_groups" | "equipment" | "categories";

export type ReferenceEntry = {
  id: string; // UUID from backend
  name: string; // canonical identifier, matches mobile enum string ("chest", "barbell")
  displayName: string | null; // human label; falls back to name in UI when null
};

export type ReferenceList = {
  kind: ReferenceListKind;
  entries: ReferenceEntry[];
  syncedAt: string; // ISO timestamp
};
```

Legacy `persistence-mobile` uses `{ id, name, display_name }` for muscle groups (display_name nullable with fallback) and `{ id, name }` for equipment (no display_name column). V2 normalises to one shape with `displayName` nullable. Categories come from the backend as `string[]` in M0 (shim) and are mapped to `ReferenceEntry` at the adapter boundary (`id` synthesised from `name` for stability).

### Port extensions

```ts
// domain/ports/api.port.ts
getReferenceList(kind: ReferenceListKind): Promise<Result<ReferenceEntry[], ApiError>>;

// domain/ports/storage.port.ts
getCachedReferenceList(kind: ReferenceListKind): Promise<ReferenceList | null>;
cacheReferenceList(kind: ReferenceListKind, entries: ReferenceEntry[]): Promise<void>;
getReferenceListAge(kind: ReferenceListKind): Promise<string | null>;
```

### SQLite schema

New table in `packages/mobile/src/adapters/storage/sqlite.adapter.ts`:

```sql
CREATE TABLE IF NOT EXISTS reference_lists (
  kind       TEXT PRIMARY KEY,
  entries    TEXT NOT NULL,          -- JSON-stringified ReferenceEntry[]
  synced_at  TEXT NOT NULL           -- ISO timestamp
);
```

`InMemoryStorageAdapter` implements the same three methods with a `Map<kind, ReferenceList>`.

### Application query — `packages/mobile/src/application/queries/reference-lists.query.ts`

```ts
export const REFERENCE_LIST_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export function getReferenceListQuery(
  storage: StoragePort,
  kind: ReferenceListKind,
  now?: () => number,
): Promise<{ entries: ReferenceEntry[]; isStale: boolean }>;

export async function refreshReferenceList(
  api: ApiPort,
  storage: StoragePort,
  kind: ReferenceListKind,
): Promise<Result<ReferenceEntry[], ApiError>>;
```

Semantics match `getExercisesQuery`: read from cache synchronously; derive `isStale` from `synced_at`; `refreshReferenceList` fetches + caches + returns the fresh entries. 24-hour staleness window.

### Enum ↔ UUID bridge

```ts
export function mapEnumToUuid(
  kind: ReferenceListKind,
  key: string, // enum string like "chest"
  cache: ReferenceList | null,
): string | undefined;
```

Looks up `entries.find(e => e.name === key)?.id`. Returns `undefined` if the cache is missing or the key isn't present; callers log + skip the affected filter rather than throwing.

### Refresh trigger

The reference-list cache refreshes on **first Exercises-tab open per app session**. Matches the existing exercise-cache refresh pattern (cheapest trigger, fires once, doesn't hammer on every app foreground). Documented for future feature-area additions to reuse the same trigger.

---

## Hierarchical Filter Modal — ported 1:1 from legacy (added M0)

M0 replaces the Phase 4 flat filter sheet with the legacy `persistence-mobile` hierarchical pattern. **Policy: 1:1 port of legacy component hierarchy, no structural redesign.** Only the data source swaps (Supabase → V2 `StoragePort`/`ApiPort` via `useReferenceLists`). The `/frontend-design` skill applies a light revamp (V2 tokens, transitions) **after** the port is verified — NOT during.

### Legacy reference paths

- `persistence-mobile/app/exercises.tsx` — owns modal state + axis detail routing
- `persistence-mobile/components/exercises/FilterContainer.tsx` — section-list presenter
- `persistence-mobile/components/exercises/FilterDetailScreen.tsx` — per-axis detail with optional search
- `persistence-mobile/components/exercises/ExerciseDetailsModal.tsx` — delete confirm alert pattern

Port component hierarchy, flow, and flags (`searchable: true` per axis). Replace Supabase hooks with V2 hooks at the seams.

### V2 route structure

Replace existing `app/(app)/exercises/filters.tsx` with a nested stack:

```
app/(app)/exercises/filters/
├── _layout.tsx         # Modal shell: close btn, title, sticky "Apply (N)" bottom bar
├── index.tsx           # Section list: 4 axes (Muscle Groups, Equipment, Difficulty, Created By)
├── muscles.tsx         # Searchable checklist (searchable: true)
├── equipment.tsx       # Searchable checklist (searchable: true)
├── difficulty.tsx      # Plain checklist (searchable: false)
└── created-by.tsx      # Plain checklist (searchable: false) — values: mine/system/pt/physio/all
```

Four axes match the legacy app. The `created_by` axis is a real filter, not decorative.

### Sticky Apply bar

Lives in `_layout.tsx` so it persists across child-route navigation. Shows `Show N exercises` with a live count derived from the same `useExerciseFilters` state that seeds the query. Submits the filter diff + dismisses the modal on tap.

### Search UX

`muscles.tsx` and `equipment.tsx` include a `SearchBar` at the top of their screen (mirrors legacy `searchable: true` flag). `difficulty.tsx` and `created-by.tsx` omit it (short lists).

### Presenter replacement

Phase 4's `ExerciseFiltersPresenter` + `ExerciseFiltersContainer` + `ExerciseFilterBar` are replaced wholesale by the nested-route structure. The Phase 4 "quick-filter rail" on the list screen (`ExerciseListPresenter`) stays — it's a separate surface.

---

## Sync-Queue Wire Format (added M0)

Phase 4 flagged that `processSyncQueue` raw-fetches `entry.payload` verbatim, bypassing `SSTApiAdapter.mapCreateExerciseInputToApi`. Domain-shaped payloads reach the server with the wrong field names (e.g. `primaryMuscleGroups` instead of `primary_muscles`).

### Decision: map at enqueue time (Option A)

`createExerciseCommand` runs `mapCreateExerciseInputToApi` before enqueueing. The queue entry stores the wire-format (snake_case) payload directly; `processSyncQueue` stays domain-agnostic and pushes the payload as-is.

**Rationale:** sync engine stays simple (no per-entity-type dispatch); mapper runs once at enqueue; fewer flush-time failure modes; the queue is an append-only log where each entry is self-describing.

### Wire format (matches backend `POST /exercises` contract)

```ts
{
  name,
  description?, instructions?,
  video_url?, thumbnail_url?,
  category?,                           // enum string
  difficulty_level?,                   // enum string
  primary_muscles?: string[],          // UUIDs
  secondary_muscles?: string[],        // UUIDs
  equipment_required?: string[],       // UUIDs
  accessibility_requirements?: string[],
  accessibility_modifications?,
  region_type?, movement_type?,
  is_public?,
}
```

UUID arrays translate from domain enums via the reference-list cache (`mapEnumToUuid`). If the cache is missing a required mapping, the enqueue returns a validation error and the UI surfaces it — the mutation is never enqueued with a broken payload.

### Optimistic local id

`createExerciseCommand` still writes a local-cache row with a `local-*` id prefix so the UI reflects the create immediately. On flush success, the server UUID replaces the local id in `cached_exercises`; any sets/workouts referencing the local id get rewritten.

---

## Exercise Domain — M0 field additions

V2's `Exercise` domain model gains two fields to support the legacy list/detail port:

```ts
export interface Exercise {
  // ...existing fields...
  videoUrl: string | null; // added M0
  thumbnailUrl: string | null; // added M0
}

export interface CreateExerciseInput {
  // ...existing fields...
  videoUrl?: string; // added M0
  thumbnailUrl?: string; // added M0
}
```

Legacy list + detail UIs render `thumbnailUrl` on cards and `videoUrl` on the detail screen. These are required for the 1:1 port.

Legacy-but-unused fields (`regionType`, `movementType`, `accessibilityRequirements`, `accessibilityModifications`, `isPublic`, `secondaryMuscles` — per the legacy audit, the V2-ported UI doesn't read these) are NOT added to the V2 domain model in M0. The adapter receives them from the backend and discards them; they re-appear on the domain model when a later milestone needs them.

`isCustom` derivation changes: previously a server field, now derived at the adapter boundary as `mapped.createdBy !== null` (V2 backend uses `created_by IS NULL` for system exercises — see § Backend Data Model Notes).

---

## UI Hooks (added M0)

- `useReferenceLists()` — React hook in `src/ui/hooks/useReferenceLists.tsx`. Reads from `StoragePort` via the DI container, refreshes via `ApiPort` on first call per session. Returns `{ muscleGroups, equipment, categories, isLoading, isStale, refresh }`. The filter modal and filter-aware containers consume this hook.

No redesign of the existing `ExerciseListContainer` / `ExerciseListPresenter` (kept from Phase 4, with `ExerciseFilterBar` removed since the nested modal replaces it).

---

## Offline search & sort (deferred — post-M0, own PR)

### Context

Legacy `persistence-mobile` used Algolia for exercise search: typo-tolerant, ranked, server-hosted. V2 is offline-first — every browse, filter, and search lookup must work against the SQLite cache without a network round-trip. That rules out Algolia as the primary path. Post-M0 the library renders all ~2.3k exercises in `created_at DESC` order with a substring `filterExercises` applied in-memory; good enough to ship, not good enough long-term.

Known limits of the post-M0 surface:

- **Substring-only matching** — `filterExercises` (domain service) does `name.toLowerCase().includes(query.toLowerCase())` plus description / instructions ILIKE on the server. No stemming, no typo tolerance, no per-word ranking.
- **No deterministic sort** — backend orders by `created_at DESC` with no secondary key; SQLite reads use insertion order (no `ORDER BY` on the cached JSON). Ties shuffle between refreshes.
- **No user-chosen sort** — alphabetical (the default lifter's mental model), "most used" (once session history lands in M3), and "my customs first" all unimplemented.
- **No index** — the SQLite cache stores each exercise as a JSON blob in a `data` column; every filter parses all 2.3k rows into JS before comparing. Works for 2.3k, will not work for 10k+.

### Likely shape of the follow-up

A dedicated PR — split backend + frontend — scoped around three concepts:

1. **Normalised search columns in SQLite.** Add indexed columns (`name`, `name_lower`, `category`, `difficulty`, `created_by_sentinel`) alongside the existing `data` JSON blob. Filtering and sort happen in SQL (`WHERE name_lower LIKE ? ORDER BY name_lower`), not JS. JSON blob stays as the source of truth; normalised columns are derived at `cacheExercises` write time.

2. **SQLite FTS5 virtual table for keyword search.** `CREATE VIRTUAL TABLE exercises_fts USING fts5(name, description, instructions)` — populated alongside the main cache insert, queried with `MATCH` when a search term is present. Gives stemming + relevance ranking (`bm25()`) + phrase support without the Algolia dependency. Typo tolerance still absent; `trigram` extension can add it later if needed.

3. **Sort vocabulary.** Domain adds a `sort` field to `ExerciseFilters`: `"name-asc" | "name-desc" | "recent" | "popular"` (popular requires session history — parked until M3+ data is flowing). Default `name-asc`, with `created_at DESC` as secondary tiebreaker. Backend takes `?sort=` and applies the matching `ORDER BY`; SQLite adapter maps the sort to the relevant column.

### Decisions deferred until that PR lands

- **"Customs pinned on top"** — separate from sort: a `isCustom DESC` prefix applied regardless of chosen sort. Likely yes; verify against legacy app.
- **Search-term highlighting in the card** — bolding matched substrings in the list title. Legacy had this; ported-then-revamp says add when the /frontend-design pass gets to M11.
- **Backend full-text search** — whether to also expose `GET /exercises?q=` with Postgres `tsvector` + `tsquery` for the online path, or keep the current ILIKE. FTS5 on the client handles the offline case regardless; the backend choice is a later decision.
- **Reference-list driven filters vs. search** — today the modal filters on `muscle_groups[]` and `equipment[]` as hard AND constraints. Keyword search runs over the full `name/description/instructions`. Keep them orthogonal or merge (search narrows _within_ filters)? Legacy did the latter; likely correct.

See `tasks.md` § Phase 9 for the work breakdown.
