# M2 — Backend Brief: Workouts CRUD + nested-exercise wire format

## Goal

Extend the existing `/workouts` Elysia handlers (which currently handle metadata only) to support nested-exercise wire format, surface `supersetGroup`, plumb the quota envelope, and close test gaps. Schema is already correct in `packages/db/src/schema.ts` — no migrations.

This is the **backend track** of M2. Read this brief plus [`BRIEF.md`](./BRIEF.md), [`SMOKE_TEST.md`](./SMOKE_TEST.md), and the parent spec [`../../04-workout-management/`](../../04-workout-management/).

## Branch + workflow

- **Branch:** `feat/m2-workouts` (shared with the frontend track) off fresh `main`
- **PR title:** `feat: workouts list + create + edit (M2)`
- **Backend commit shape (lands first in the shared branch's history):**
  1. `docs(specs/04): close M2 spec gaps — domain model, API contract, ACs`
  2. `feat(workouts): add supersetGroup + nested exercises to list and get`
  3. `feat(workouts): atomic create/update with nested exercises`
  4. `feat(workouts): quota envelope on type=mine list`
  5. `test(workouts): two-user isolation, friends visibility, nested-exercise round-trips`
  6. (optional) `chore(workouts): tidy WorkoutRepository helpers`

Each implementation commit ends with the standard footer:

```
Spec alignment: <citations from 04-workout-management/{design,requirements,tasks}.md>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

## Files you'll touch

- `microservices/core/src/application/repositories/workoutRepository.ts` — `WorkoutWithExercises` type, `list`, `getById`, `create` → `createWithExercises`, `update`, new `getQuota`. All non-trivial changes here.
- `microservices/core/src/application/repositories/workoutService.ts` — re-export new methods if needed.
- `microservices/core/src/application/workouts/list/workoutsListHandler.ts` — query type widening (already has `type`/`limit`/`offset`); response envelope to `{ data, meta: { pagination, quota? } }`.
- `microservices/core/src/application/workouts/get/workoutsGetHandler.ts` — only response shape; auth + visibility logic is correct.
- `microservices/core/src/application/workouts/create/workoutsCreateHandler.ts` — extend body schema for nested `exercises[]`; call `createWithExercises`.
- `microservices/core/src/application/workouts/update/workoutsUpdateHandler.ts` — extend body schema for optional `exercises[]`; call updated `update` method.
- `microservices/core/src/application/workouts/delete/workoutsDeleteHandler.ts` — verify existing 204 response, no expected change beyond owner-only / 404 semantics.
- All `__tests__/*.test.ts` neighbours — extensive additions.

## Files you must NOT touch

- `microservices/core/src/application/dashboard/` — M1.
- `microservices/core/src/application/exercises/` — M0; reference-only to confirm convention.
- `packages/db/src/schema.ts` — M2 has no migration.
- Mobile package (`packages/mobile/`) — frontend track owns this.

## Wire format (the contract — frontend depends on it)

### `GET /workouts?type=mine|assigned|default&limit&offset`

```
{
  "data": [
    {
      "id": "...",
      "name": "Push Day",
      "description": null,
      "createdBy": "...",
      "visibility": "private",
      "estimatedDurationMinutes": 45,
      "createdAt": "...",
      "updatedAt": "...",
      "exercises": [
        {
          "id": "...",                // workout_exercises.id
          "exerciseId": "...",
          "sortOrder": 0,
          "supersetGroup": null,      // <-- M2 must surface this
          "targetSets": 4,
          "targetRepsMin": 8,
          "targetRepsMax": 12,
          "targetDurationSeconds": null,
          "restSeconds": 90,
          "notes": null,
          "exercise": {               // joined; nullable iff exercise was deleted
            "id": "...",
            "name": "Bench Press",
            "category": "strength",
            "difficultyLevel": "intermediate",
            "videoUrl": null,
            "thumbnailUrl": null
          }
        }
      ]
    }
  ],
  "meta": {
    "pagination": { "limit": 20, "offset": 0, "total": 47 },
    "quota": { "used": 12, "limit": 50 }   // ONLY present when type=mine
  }
}
```

### `GET /workouts/:id`

```
{ "data": { ...same shape as a list element, with exercises[] always populated and ordered by sortOrder } }
```

`404` when not found OR when the user lacks visibility access (private not owned, friends without accepted friendship).

### `POST /workouts`

**Body:**

```
{
  "name": "Push Day",                       // required, non-empty after trim
  "description": "Optional",
  "visibility": "private",                  // default private
  "estimatedDurationMinutes": 45,           // default 30
  "exercises": [
    {
      "exerciseId": "...",                  // required FK to exercises.id
      "sortOrder": 0,                       // required
      "supersetGroup": null,                // optional
      "targetSets": 4,                      // optional
      "targetRepsMin": 8,                   // optional, default 1 in DB
      "targetRepsMax": 12,                  // optional, default 1 in DB
      "targetDurationSeconds": null,        // optional
      "restSeconds": 90,                    // optional, default 90 in DB
      "notes": null                         // optional
    }
  ]
}
```

`exercises` is optional in the schema (allow metadata-only POST for testing) but the M2 frontend always sends ≥1. Validation: if `exercises` present, must be an array; each entry must have `exerciseId` (uuid) and `sortOrder` (integer ≥0). `targetRepsMin <= targetRepsMax` when both set.

**Response:** `201 { data: Workout }` — same shape as `GET /workouts/:id`. Returned via re-fetch within the transaction.

Atomicity: workout insert + multi-row exercise insert run in a single `db.transaction(...)`. On any insert error, both roll back. On success, return the newly-created workout with its full nested exercises array (re-fetched within the same transaction context).

### `PATCH /workouts/:id`

**Body (all fields optional; partial update):**

```
{
  "name": "Push Day Heavy",
  "description": "Updated",
  "visibility": "friends",
  "estimatedDurationMinutes": 60,
  "exercises": [ ...same shape as POST exercises... ]
}
```

When `exercises` is **absent** from the body, only metadata fields update.

When `exercises` is **present**, it's a full replacement: `db.transaction(...)` deletes all `workout_exercises` rows for `workoutId = id`, inserts the new array, then re-fetches and returns the full workout. This means the client always sends the complete desired final state.

**Response:** `200 { data: Workout }` on success. `404` when the workout doesn't exist OR the caller is not the owner — do not leak ownership via `403`.

### `DELETE /workouts/:id`

**Response:** `204` on success, `404` when not found / not owner. FK cascade on `workout_exercises.workoutId` cleans up junction rows; sessions get `workoutId = NULL` via FK `set null`. No body changes from the current handler — verify behaviour and ownership-401 vs 404 conventions match.

## Repository changes

In `microservices/core/src/application/repositories/workoutRepository.ts`:

1. **`WorkoutWithExercises` type** — add `supersetGroup: number | null` to the `exercises[]` element type.
2. **`list(userId, filters)`** — change return type to `Promise<{ workouts: WorkoutWithExercises[], total: number }>`. Two-step: count query for `total`, then the existing select widened to:
   - Outer query: `workouts` filtered per `type` semantics.
   - Inner: a follow-up grouped fetch on `workout_exercises` joined to `exercises` for all returned workout IDs (`inArray(workoutExercises.workoutId, returnedIds)`), grouped client-side and zipped onto each workout. Single Drizzle round-trip after the initial paginated fetch. Order exercises by `sortOrder`.
   - `default` semantics: `eq(workouts.visibility, "public")` AND `ne(workouts.createdBy, userId)`.
3. **`getById(id, userId)`** — add `supersetGroup` to the select clause; otherwise unchanged. Friends-visibility logic stays as-is.
4. **`createWithExercises(userId, input)`** — replaces the old `create`. Wraps both inserts in `db.transaction`. After insert, re-fetch via `getById(workoutId, userId)` inside the same transaction. Return the result.
5. **`update(id, userId, data)`** — accept optional `exercises: CreateWorkoutExerciseInput[]`. If present, run inside transaction: delete all `workout_exercises` for `workoutId = id`, insert new, re-fetch via `getById`. If absent, current single-row update. Return `WorkoutWithExercises | null`.
6. **`delete(id, userId)`** — unchanged from current implementation.
7. **`getQuota(userId)`** — new method. Two queries: `select count(*) from workouts where createdBy = userId` and `select workoutLimit from subscriptions where userId = userId limit 1`. Returns `{ used: number, limit: number | null }`. `null` limit means unlimited / no subscription row.

## Test gaps to close

In each handler's `__tests__` neighbour, plus `workoutRepository.test.ts`:

1. **Two-user isolation** on `list`, `get`, `update`, `delete`. Create users A and B + workout owned by A, verify B never sees / cannot modify it.
2. **Friends-visibility positive path** on `get`. Bidirectional `friendships.status = 'accepted'` allows B to GET A's `friends`-visible workout.
3. **Nested-exercise round-trip** on `create` and `update`. POST a workout with 3 exercises (1 standalone + 2 in a superset), GET it back, verify `supersetGroup` matches; PATCH replacing the exercise list, GET, verify deletion of old rows and insertion of new.
4. **Atomic transaction failure** on `create`. Simulate an FK violation on the second exercise (invalid `exerciseId`); verify the workout row is also rolled back.
5. **Quota envelope** on list. `type=mine` includes `meta.quota`; `type=assigned` and `type=default` omit it.
6. **`default` excludes own publics**. User A's public workout shows under `mine` but not under `default` for A. Other users see it under `default`.
7. **Pagination total** on list. `meta.pagination.total` reflects the unfiltered count, regardless of `limit`/`offset`.

Coverage target: **≥90% on every metric for every changed file**, both lines / functions / branches / statements. Mobile aggregate is currently the high bar (~98 / 93 / 96 / 98); core's last-baseline on the dashboard files was 99 / 91 / 99 / 99. Don't drop below.

## Quality gates

```
bun run prettier:check
bun run typecheck
bun run lint
bun run build
bun run test:unit
```

All clean before opening the PR. CI runs the same set; expect tests to pass on first push.

## PR description shape

Use the same template M0 + M1 used. Mandatory sections:

```markdown
## Spec alignment

- 04-workout-management/design.md § API Contract (M2 backend) — implemented
- 04-workout-management/design.md § Domain Model — implemented (supersetGroup added)
- 04-workout-management/requirements.md STORY-001 ACs 1.1, 1.6, 1.9 — backend
- 04-workout-management/requirements.md STORY-002 AC 2.10 — atomic POST
- 04-workout-management/requirements.md STORY-004 AC 4.5 — full-replacement PATCH
- 04-workout-management/requirements.md STORY-005 ACs 5.2, 5.3 — DELETE + cascade
- 04-workout-management/requirements.md STORY-006 ACs 6.1–6.6 — visibility
- 04-workout-management/requirements.md STORY-009 ACs 9.1–9.5 — data isolation tests

## How to view

[Reference SMOKE_TEST.md steps; backend can self-verify steps 1–4 + 11 with curl]

## Test coverage

[Pasted from `bun run test:unit --coverage` summary]
```

## Coordinate with the frontend track

Both tracks land in the same PR (`feat/m2-workouts`); the wire-format contract above is binding for the frontend's `SSTApiAdapter`. If field names / shapes change during implementation, update both sides in the same commit batch and re-run the relevant tests.
