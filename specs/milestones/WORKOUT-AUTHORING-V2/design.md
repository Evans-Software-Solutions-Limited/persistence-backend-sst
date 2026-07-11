# Workout Authoring v2 — Design

> Pairs with `requirements.md` + `tasks.md`. File/line anchors below are from the
> 2026-07-12 recon and may drift — re-grep before editing.

## Decision record

See `requirements.md § Locked decisions` (D1–D8). This design realises them with
the **minimum** surface change, preserving athlete behaviour and reusing every
existing endpoint/path where possible.

Key seams confirmed by recon:

- `GET /workouts?type=mine|assigned|default` — `mine` = `eq(createdBy, userId)`;
  `assigned` = subquery on `workout_assignments (clientId = me AND show_in_library
= true)`; quota attached only for `mine`
  (`workoutRepository.ts` `buildListWhereClause` ~L291-321, `list` ~L97-137).
- `POST /workouts` — validate → `assertEntitlement(userId,"create_workout")`
  (402 on fail) → `createWithExercises` (`workoutsCreateHandler.ts`).
- `canRead` (`workoutRepository.ts` ~L323-370) — owner ∪ public ∪ accepted-friend
  ∪ **assignment grant**; the history endpoint reuses it verbatim.
- History source — `workout_sessions (workout_id, user_id, status, completed_at,
total_duration_seconds)` → `session_exercises (session_id)` → `exercise_sets
(session_exercise_id, weight_kg, reps)`. Volume = `SUM(weight_kg × reps)`
  (`volumeRepository.ts`).
- Ad-hoc assign — `POST /trainers/me/clients/:clientId/workout-assignments`
  (`program_assignment_id = null`), `assertTrainerCanActForClient` gated.

---

## Schema

### 1. New column `workouts.show_in_owner_library`

Migration `supabase/migrations/<ts>_workouts_show_in_owner_library.sql`
(idempotent, timestamped after the newest applied migration at authoring time):

```sql
-- Owner-visibility flag: does this workout appear in its AUTHOR's personal
-- "My Workouts"? Distinct from workout_assignments.show_in_library (client-side
-- assigned-occurrence visibility) and from the visibility enum (social sharing).
-- Default true so every pre-existing workout + every athlete-authored workout
-- stays personal; coach-authored workouts are created with false (app-side).
ALTER TABLE workouts
  ADD COLUMN IF NOT EXISTS show_in_owner_library boolean NOT NULL DEFAULT true;
```

Drizzle mirror in `packages/db/src/schema.ts` (`workouts`, ~L569-582):

```ts
showInOwnerLibrary: boolean("show_in_owner_library").notNull().default(true),
```

No index needed: the filtered query is already `created_by = me` (a small,
per-user set); the added predicate is a cheap boolean filter on that set.

**No other schema change.** No new tables. Trainer-tier caps unchanged (D8).

---

## Backend

### 2. List: owner-library filter (opt-in)

`GET /workouts` gains an optional query param **`ownerLibraryOnly`** (boolean,
default false). Handler passes it through to `WorkoutRepository.list`. In
`buildListWhereClause`, the `mine` branch becomes:

```ts
case "mine":
  return ownerLibraryOnly
    ? and(eq(workouts.createdBy, userId), eq(workouts.showInOwnerLibrary, true))
    : eq(workouts.createdBy, userId);
```

- Only affects `type=mine`. `assigned` / `default` unchanged.
- Param absent ⇒ identical to today (athlete-safe, back-compat).
- **Quota unchanged** — `getQuota` keeps `COUNT(created_by = me)` over all
  authored workouts (D4.4). The filter is display-only.

Validation: add `ownerLibraryOnly: t.Optional(t.Boolean())` to the list query
schema. Elysia coerces `?ownerLibraryOnly=true`.

### 3. Create / update: persist `show_in_owner_library`

- `workoutsCreateHandler` body schema (`t.Object`) gains
  `showInOwnerLibrary: t.Optional(t.Boolean())`. Passed to
  `createWithExercises`. **Default `true`** when absent (legacy-safe).
- `createWithExercises` insert adds `showInOwnerLibrary: input.showInOwnerLibrary
?? true`.
- The update handler + `WorkoutRepository.update` accept and persist
  `showInOwnerLibrary` (only when present — don't clobber on partial PATCH;
  mirror the existing partial-update pattern).
- **Entitlement gate untouched** — create still runs
  `assertEntitlement(create_workout)`; trainers pass (limit NULL).

### 4. History aggregation — `GET /workouts/:id/history`

New handler `microservices/core/src/application/workouts/history/`
(`workoutHistoryHandler.ts` + a `WorkoutHistoryRepository` method or a method on
`WorkoutRepository`). Auth: `requireAuth`; then `canRead(userId, workoutId)` — if
false, **404** (mirror the detail GET's not-found semantics; don't leak
existence). Scope every query to `user_id = me`.

Three reads (all Drizzle `sql` fragments, repo convention — no raw
`db.execute`), ideally 1–2 round-trips:

1. **Aggregate** over completed sessions of this workout for me:
   ```sql
   SELECT count(*)                                   AS completed_count,
          max(completed_at)                          AS last_completed_at,
          avg(total_duration_seconds)                AS avg_duration_seconds
   FROM workout_sessions
   WHERE user_id = :me AND workout_id = :id AND status = 'completed';
   ```
2. **Last session id + its duration/date** (the most recent completed):
   `ORDER BY completed_at DESC NULLS LAST LIMIT 1`.
3. **Last-session volume** — `SUM(weight_kg × reps)` joining
   `session_exercises → exercise_sets` for that session id
   (`COALESCE(..., 0)::float`, the `volumeRepository` formula).

Response DTO (numbers as numbers, timestamps ISO):

```ts
type WorkoutHistory = {
  completedCount: number; // 0 when never done
  lastCompletedAt: string | null; // ISO
  avgDurationSeconds: number | null; // null when count = 0
  lastSession: {
    completedAt: string; // ISO
    totalVolumeKg: number; // SUM(weight_kg × reps)
    durationSeconds: number | null; // total_duration_seconds
  } | null; // null when never done
};
```

Empty state: `completedCount = 0`, everything else null, HTTP 200 (STORY-008.4).

**Guard the SQL with a PgDialect render test** (per
`reference_drizzle_groupby_param_bug` — the unit suite mocks `getDb`, so SQL bugs
ship green otherwise): assert the rendered SQL contains the `user_id`, `workout_id`
and `status = 'completed'` predicates and the `weight_kg * reps` volume term.

Mounting: register under the workouts routes app next to `GET /workouts/:id`.

### 5. Ad-hoc create+assign — no new backend

STORY-007 reuses `POST /trainers/me/clients/:clientId/workout-assignments`
(exists, `assertTrainerCanActForClient` gated, `program_assignment_id = null`).
The mobile flow is create-then-assign (two calls); **no backend change**. Verify
the existing assign endpoint accepts an ad-hoc `workoutId` with no programme
context (recon: it does).

### 6. Authorization matrix

| Route                                               | Guard                                               | Notes                                  |
| --------------------------------------------------- | --------------------------------------------------- | -------------------------------------- |
| `GET /workouts?type=mine&ownerLibraryOnly=`         | `requireAuth`; scoped `created_by = me`             | filter is display-only; no new authz   |
| `POST /workouts` (+`showInOwnerLibrary`)            | `requireAuth` + `assertEntitlement(create_workout)` | unchanged gate                         |
| `PATCH /workouts/:id` (+`showInOwnerLibrary`)       | `requireAuth` + ownership-in-WHERE                  | 404 if not owner                       |
| `GET /workouts/:id/history`                         | `requireAuth` + `canRead`                           | scoped `user_id = me`; 404 on !canRead |
| `POST /trainers/me/clients/:id/workout-assignments` | `assertTrainerCanActForClient`                      | existing ad-hoc path                   |

### 7. Tier caps guard (D8)

Add a unit/integration test asserting the seeded trainer tiers
(`individual_trainer`, `small_business`, `medium_enterprise`) resolve
`workout_limit === null` and that `assertEntitlement(create_workout)` returns
`allowed: true` for a trainer regardless of count. No runtime change.

---

## Mobile

All presenters match the v3 prototype 1:1 (migration discipline). Data layer is
the bespoke **cache-first** pattern (no react-query): `useWorkouts()`,
`workouts.query.ts`, `StoragePort` cache slots, command files that enqueue via
the sync worker.

### 8. Creator v3 (`WorkoutCreatorPresenter` + `ExerciseConfigCard`)

- **Add the Visibility tri-state** to the creator (lift the editor's
  `VISIBILITY_OPTIONS` render into the shared form; the form state + command
  already carry `visibility`). Fixes the "creation always private" gap. Match
  `workout-creator.jsx` Visibility block.
- **Superset styling delta:** change the group treatment to the centred
  **SUPERSET {letter}** pill on a connector line + closing connector below. The
  3px left primary accent on members and the shared sets/rest-from-lead
  inheritance **already match** — keep them. Letter scheme A/B/C… (was numeric).
  Apply in `ExerciseConfigCard` group wrapper (recon: current badge is a
  left-anchored square at ~L79-92, styles ~L350-367).
- **Owner-visibility toggle (coach-only):** render a "Show in my workouts" toggle
  **only when the creation context is coach** (see §11). Default OFF in coach
  context; not rendered in athlete context (value sent `true`). Wire into
  `useWorkoutForm` state → `toCreateWorkoutInput` → command.
- Preserve all legacy behaviours (steppers, rep range, add/remove/reorder,
  auto-ungroup, delete confirm, validation).

### 9. Editor parity

`WorkoutEditorPresenter` already renders Visibility. Add the same coach-only
owner-visibility toggle so a coach can flip `show_in_owner_library` after the
fact, and apply the matched superset styling (shared component). PATCH sends
`showInOwnerLibrary` only when the coach changed it.

### 10. Detail v3 (`WorkoutDetailPresenter` + container)

- **Hero card:** primary-gradient card with equipment eyebrow, name,
  duration/exercises/**total-sets** stats, muscle pills. Total-sets = `Σ
targetSets`. Muscles derived from the cached exercise library via the same
  `classifyWorkoutSplit` join the list uses (`WorkoutsListContainer` L61-79).
  Equipment token derived likewise from cached exercises' equipment; **if the
  cached exercise record has no equipment field, omit the equipment token** and
  render just "WORKOUT" (flag to Brad; no DTO change in v1).
- **History block:** new `useWorkoutHistory(workoutId)` cache-first hook →
  `api.getWorkoutHistory(id)` → `GET /workouts/:id/history`; new StoragePort
  cache slot `cachedWorkoutHistory`. Presenter renders LAST DONE (relative from
  `lastCompletedAt`) · COMPLETED × · AVG TIME + "Last session · {date} ·
  {volume} · {min}" footer. **Empty state** (`completedCount = 0`) → omit the
  block (or neutral "Not done yet"), never render zeros as data.
  - Relative-date + volume formatting: reuse existing mobile formatters
    (`formatDuration`, a relative-time helper if present; else a small pure
    helper with unit tests). Respect the user's weight unit for volume display.
- **Superset styling:** match the creator (centred letter pill + connector + 3px
  left accent) in the detail's plan list (recon: current inline "Superset N"
  badge ~L159-165).
- Start CTA + per-exercise nav unchanged.
- The container currently fetches only `useWorkout(id)`; add the parallel
  `useWorkoutHistory(id)` (independent cache; renders when present).

### 11. Coach surfaces + list branch

- **Personal My Workouts (Train tab, `WorkoutsListContainer`):** read
  `isTrainerEligible` from `useUserMode` (`@/state/user-mode`). When a trainer,
  request `mine` with `ownerLibraryOnly=true`; else unchanged. The mine+assigned
  merge (L48-52) stays; only the `mine` fetch param changes. Add
  `ownerLibraryOnly` to `refreshWorkouts`/`getWorkouts` params + cache key so the
  trainer's filtered `mine` doesn't collide with an unfiltered cache entry.
- **Coach Workouts library (new screen):** coach-gated route (mirror
  `ProgramEditorContainer` redirect: `if (mode !== "coach") router.replace(...)`).
  Reuses the list rendering with a **coach-library variant**: `mine` fetched
  **unfiltered** (all authored), a "Your workouts" section + templates
  (`default`) for start-from-template, no `assigned` merge, a "Create workout"
  CTA (`router.push("/(app)/workouts/create?ctx=coach")`), tap → edit. Entry
  point: a "Workout library" row in the coach **You** section (adjustable; not
  prototype-specified — flag to Brad).
- **Client Detail create+assign (STORY-007):** a "Create & assign workout" action
  → creator in coach context → on save, `createWorkout` then
  `assignClientWorkout(clientId, workoutId)` (ad-hoc). Surface assign errors;
  keep the created workout on partial failure.
- **Creation context (`ctx=coach`)** drives: (a) render the owner-visibility
  toggle, (b) default `show_in_owner_library = false`. Athlete entry
  (`/(app)/workouts/create` with no ctx) → no toggle, value `true`. Thread the
  context via a route param or a small creator prop.

### 12. API port + data-layer additions

- `api.port.ts`: `getWorkouts(params)` gains `ownerLibraryOnly?: boolean`;
  `CreateWorkoutDomainInput` + `UpdateWorkoutDomainInput` gain
  `showInOwnerLibrary?: boolean`; new `getWorkoutHistory(id): WorkoutHistory`.
- SST adapter: pass the query param; map the history response. InMemory adapter:
  mirror for tests.
- Domain: `Workout` gains `showInOwnerLibrary: boolean`; new `WorkoutHistory`
  model. `CreateWorkoutInput`/`UpdateWorkoutInput` gain the flag; commands
  (`create-workout.command`, `update-workout.command`) thread it.
- `workouts.query.ts` + StoragePort: `ownerLibraryOnly` in the `mine` cache key;
  new `getCachedWorkoutHistory`/`cacheWorkoutHistory` slots.

---

## Risks & mitigations

| Risk                                                                                     | Mitigation                                                                                       |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Trainer's filtered `mine` collides with unfiltered cache (coach library vs personal)     | Include `ownerLibraryOnly` in the cache key; distinct slots.                                     |
| SQL bug ships green (mocked `getDb`)                                                     | PgDialect render test on the history query (predicates + volume term).                           |
| Equipment token has no data source on the mobile DTO                                     | Derive from cached exercises; omit token if absent (no DTO change v1); flag to Brad.             |
| Partial failure in create+assign loses work                                              | Two-step flow keeps the created workout; surface the assign error; retry via AssignWorkoutSheet. |
| Owner-visibility confused with `workout_assignments.show_in_library` / `visibility` enum | Distinct column + names; documented in schema comment + requirements D1.                         |
| History leaks another user's data                                                        | Every history query filtered `user_id = me`; two-user isolation test.                            |
| Default-true column flips coach intent                                                   | App sends `false` from coach contexts; DB default true only backfills legacy/athlete rows.       |
