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
