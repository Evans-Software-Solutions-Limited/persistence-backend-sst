# 04 — Workout Management: Technical Design

## Domain Model

```typescript
// src/domain/models/workout.ts (mobile) / mirrors backend response shapes
export interface Workout {
  id: string;
  name: string;
  description: string | null;
  createdBy: string; // FK → profiles.id; never injectable from request body
  visibility: WorkoutVisibility;
  estimatedDurationMinutes: number; // not null, default 30 in DB
  exercises: WorkoutExercise[]; // populated by GET /workouts/:id and GET /workouts list
  createdAt: string;
  updatedAt: string;
}

export interface WorkoutExercise {
  id: string;
  exerciseId: string;
  sortOrder: number;
  supersetGroup: number | null; // null = standalone; same int = same superset
  targetSets: number | null;
  targetRepsMin: number; // not null, default 1
  targetRepsMax: number; // not null, default 1
  targetDurationSeconds: number | null;
  restSeconds: number | null; // default 90 in DB
  notes: string | null;
  // Joined exercise metadata (present on GET /workouts/:id, optional on list)
  exercise?: {
    id: string;
    name: string;
    category: string;
    difficultyLevel: string;
    videoUrl: string | null;
    thumbnailUrl: string | null;
  } | null;
}

export type WorkoutVisibility = "private" | "friends" | "public";

export interface CreateWorkoutInput {
  name: string;
  description?: string;
  visibility?: WorkoutVisibility;
  estimatedDurationMinutes?: number;
  exercises: CreateWorkoutExerciseInput[]; // M2: required, atomic
}

export interface CreateWorkoutExerciseInput {
  exerciseId: string;
  sortOrder: number;
  supersetGroup?: number;
  targetSets?: number;
  targetRepsMin?: number; // default 1
  targetRepsMax?: number; // default 1
  targetDurationSeconds?: number;
  restSeconds?: number; // default 90
  notes?: string;
}

export interface UpdateWorkoutInput {
  name?: string;
  description?: string;
  visibility?: WorkoutVisibility;
  estimatedDurationMinutes?: number;
  // When `exercises` is provided, the backend treats it as a FULL REPLACEMENT
  // of the workout's exercise list — existing junction rows are deleted and
  // the supplied array is inserted atomically. Omit to update metadata only.
  exercises?: CreateWorkoutExerciseInput[];
}
```

The schema mirrors `packages/db/src/schema.ts` exactly — `workouts` table + `workout_exercises` junction. Supersets are represented via the integer `supersetGroup` column on `workout_exercises`; there is **no separate `workout_supersets` table**. Two exercises share a superset iff they have equal non-null `supersetGroup` within the same workout.

## API Contract (M2 backend)

All routes live under `/workouts` on the core Elysia API. Auth via Supabase JWT in the `Authorization` header → `requireAuth` middleware. `userId` is derived from the JWT sub claim and is **never** read from the request body.

### `GET /workouts` — list

**Query params:**

- `type?: "mine" | "assigned" | "default"` — default `mine`
- `limit?: number` — default 20
- `offset?: number` — default 0

**Response:** `{ data: Workout[], meta: { pagination: { limit, offset, total }, quota?: { used: number, limit: number | null } } }`

`meta.quota` is included **only when `type=mine`**. `used` = count of workouts where `createdBy = userId`. `limit` = `subscriptions.workoutLimit` for the user, or `null` if unlimited / no subscription row. `meta.pagination.total` is the row count for the query before limit/offset.

Each `Workout` in the list includes its full `exercises[]` array with joined `exercise` metadata. The list is read-heavy (~20 workouts × ~6 exercises each = ~120 junction rows joined to exercises) but avoids N+1 on the list screen — a single round-trip renders the entire list with `WorkoutCard` summaries.

**Filter semantics:**

- `mine` — `workouts.createdBy = userId`. Returns all visibilities (you see your own private workouts).
- `assigned` — workouts referenced by `workout_assignments` rows where `clientId = userId`. Returns regardless of workout visibility (an assigned workout is intended to be visible to its assignee).
- `default` — `workouts.visibility = 'public'` AND `createdBy IS NULL OR createdBy != userId` (excludes your own public workouts; those show under `mine`).

### `GET /workouts/:id` — detail

**Response:** `{ data: Workout }` or `404` when the workout doesn't exist or the user lacks visibility access.

Visibility access rules:

- Owner (`createdBy = userId`) — always allowed.
- `visibility = 'public'` — allowed.
- `visibility = 'friends'` — allowed iff a row exists in `friendships` with `(userId, ownerId)` or `(ownerId, userId)` and `status = 'accepted'`.
- `visibility = 'private'` — only owner.

### `POST /workouts` — create with nested exercises (atomic)

**Body:** `CreateWorkoutInput` (see types above). `name` required + non-empty. `exercises` optional but if present must be a non-empty array; M2 frontend always sends ≥1.

The handler runs the workout insert + the multi-row `workout_exercises` insert in a single Drizzle transaction. On any insert failure, both roll back. Returns `201 { data: Workout }` with the full nested exercises array (re-fetched within the transaction).

### `PATCH /workouts/:id` — partial update; nested-exercise full-replacement

**Body:** `UpdateWorkoutInput` (see types above).

When `exercises` is present in the body, the handler runs in a single transaction: delete all `workout_exercises` rows for `workoutId = id`, insert the new array, return the full updated workout. When `exercises` is absent, only the metadata fields (`name` / `description` / `visibility` / `estimatedDurationMinutes`) are updated.

Full-replacement is intentional. The legacy edit form submits the desired final state of the exercise list; client-side diffing into add/update/delete operations adds complexity without buying anything for the M2 use cases. Returns `200 { data: Workout }`.

Authorization: only the owner (`createdBy = userId`) can PATCH. Non-owners get `404` (not `403`) — leaking ownership is unnecessary.

### `DELETE /workouts/:id`

Soft-delete is **not** in M2. The current `delete` is a hard delete; the FK cascade on `workout_exercises.workoutId` cleans up junction rows. Sessions have `onDelete: 'set null'` on `workoutId`, so historical sessions are preserved without their template reference. STORY-005's "soft delete" AC is downgraded to a tasks.md follow-up — workouts that have been performed should arguably be soft-deleted to preserve session lineage, but that wires into M4 progress and is out of scope here.

Authorization: owner-only. Non-owners get `404`. Returns `204` on success.

### Single vs double envelope

- `GET /workouts` (list) — **double envelope**: `{ data: [...], meta: {...} }`. Same pattern as M0 `/exercises`.
- `GET /workouts/:id`, `POST`, `PATCH` — **single envelope**: `{ data: {...} }`. Same pattern as M1 `/dashboard`.
- `DELETE` — `204` no body.

The mobile adapter `requestEnvelope<T>` unwraps one `data` layer for single-envelope endpoints; list endpoints use `requestPaginatedEnvelope<T>` which handles both. M2 must not double-wrap on the backend or double-unwrap on the frontend.

## Domain Services

```typescript
// src/domain/services/workoutService.ts (mobile)
export function validateWorkout(
  input: CreateWorkoutInput,
): Result<void, ValidationError[]>;
export function calculateEstimatedDuration(
  exercises: WorkoutExercise[],
): number;
export function reorderExercises(
  exercises: WorkoutExercise[],
  fromIndex: number,
  toIndex: number,
): WorkoutExercise[];
export function groupAsSuperSet(
  exercises: WorkoutExercise[],
  exerciseIds: string[],
): WorkoutExercise[];
export function ungroupSuperSet(
  exercises: WorkoutExercise[],
  supersetGroup: number,
): WorkoutExercise[];
export function propagateSupersetSharedFields(
  exercises: WorkoutExercise[],
  supersetGroup: number,
  shared: Pick<WorkoutExercise, "targetSets" | "restSeconds">,
): WorkoutExercise[];
```

`propagateSupersetSharedFields` is M2-new — when the user edits `targetSets` or `restSeconds` on the lead exercise of a superset, the change must propagate to all peers in the same group. Pure function; runs on every edit in `WorkoutEditorContainer` reducer.

## Port Extensions

```typescript
// ApiPort additions (M2 — replaces M1 stubs)
getWorkouts(params?: { type?: WorkoutListType; limit?: number; offset?: number }):
  Promise<Result<{ workouts: Workout[]; quota?: WorkoutQuota }, ApiError>>;
getWorkout(id: string): Promise<Result<Workout, ApiError>>;
createWorkout(data: CreateWorkoutInput): Promise<Result<Workout, ApiError>>;
updateWorkout(id: string, data: UpdateWorkoutInput): Promise<Result<Workout, ApiError>>;
deleteWorkout(id: string): Promise<Result<void, ApiError>>;

// StoragePort additions (M2)
getCachedWorkouts(userId: string, type: WorkoutListType): Promise<Workout[]>;
cacheWorkouts(userId: string, type: WorkoutListType, workouts: Workout[]): Promise<void>;
getCachedWorkout(userId: string, id: string): Promise<Workout | null>;
cacheWorkout(userId: string, workout: Workout): Promise<void>;
removeCachedWorkout(userId: string, id: string): Promise<void>;
getWorkoutsCacheAge(userId: string, type: WorkoutListType): Promise<number | null>;
```

## SQLite cache shape

Two new tables in the mobile SQLite schema, scoped by `userId` and `type`:

```sql
CREATE TABLE IF NOT EXISTS cached_workouts (
  user_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('mine', 'assigned', 'default')),
  payload TEXT NOT NULL,    -- JSON-serialized Workout[]
  quota TEXT,               -- JSON-serialized WorkoutQuota | null (only set for type='mine')
  synced_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, type)
);

CREATE TABLE IF NOT EXISTS cached_workout_detail (
  user_id TEXT NOT NULL,
  workout_id TEXT NOT NULL,
  payload TEXT NOT NULL,    -- JSON-serialized Workout (with full exercises)
  synced_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, workout_id)
);
```

`WORKOUTS_LIST_STALE_AFTER_MS = 5 * 60 * 1000` (5 min, matches dashboard TTL — workouts list shifts when a session completes or a PT assigns).

## UI Components (mobile)

```
containers/WorkoutsListContainer.tsx          # Tabs, search, popover state
presenters/WorkoutsListPresenter.tsx          # Three-section list, pull-to-refresh
containers/WorkoutCreatorContainer.tsx        # Form state, exercise picker
presenters/WorkoutCreatorPresenter.tsx        # Form UI
containers/WorkoutEditorContainer.tsx         # Same form, async-loaded
presenters/WorkoutEditorPresenter.tsx         # Same form UI

# Section / item components — ported verbatim from persistence-mobile/components/workouts/
ui/components/workouts/WorkoutCard/           # List item, with start/edit/delete
ui/components/workouts/WorkoutSection/        # Expandable section header + body
ui/components/workouts/WorkoutPopover/        # Modal detail view
ui/components/workouts/WorkoutLimitIndicator/ # Quota CTA
ui/components/workouts/QuickActions/          # Top action bar
ui/components/workouts/AddExercisePopover/    # Bottom-sheet picker (creator + editor)
ui/components/workouts/AddExerciseList/       # Multi-select list inside picker
ui/components/workouts/ExerciseDetailsModal/  # Drill-in detail inside picker
ui/components/workouts/ExerciseConfigCard/    # Per-exercise form card with superset visuals
ui/theme/workoutsLegacyTheme.ts               # V2 compat shim — extends homeLegacyTheme
```

The picker re-uses the **M0 `ExerciseListContainer`** under the hood — it already filters / paginates against `GET /exercises` and is reference-list-aware. M2 wraps it in a multi-select sheet with two CTAs ("Add as exercises" / "Add as superset").

## Offline Strategy

- **Reads cache-first with 5-minute TTL.** Same pattern as M1 dashboard.
- **Writes are queued through `SyncQueuePort`.** Each create/update/delete becomes a queued mutation. M0 proved this for exercises; M2 extends to workouts. The sync worker replays in order; conflicts are server-wins (last-write-wins). Server-issued IDs replace client-issued temp UUIDs on successful POST.
- **Optimistic UI on writes.** Form submit returns immediately with the local cached row; user proceeds. If the queued sync fails after retries, a banner surfaces in the Workouts tab with a retry CTA.

## Visibility & access control

Implemented in `WorkoutRepository.getById` (already shipped). M2 verifies under test:

- Owner sees private / friends / public.
- Friend sees `friends` (bidirectional `friendships.status = 'accepted'`).
- Stranger sees only `public`.
- Non-owner gets `404` on PATCH / DELETE attempts (not `403`).

## Out of scope (deferred)

- **Active session navigation.** "Start workout" CTAs render but route to a coming-soon stub. Real wiring is M3.
- **Drag-and-drop reorder.** Legacy doesn't have it. STORY-002's drag-and-drop AC is reclassified as M11 polish.
- **Soft-delete on workouts that have sessions.** STORY-005 hard-deletes; sessions retain `workoutId IS NULL` via FK `set null`. Soft-delete is a tasks.md follow-up.
- **Workout programs.** `workout_programs` / `program_workouts` exist in schema but no M2 surface touches them. M8 (Trainer features) revisits.
- **Workout assignments writes.** M2 reads from `workout_assignments` for the Assigned tab; M8 adds the trainer-side write surface.
