# M2 — Frontend Brief: Port workouts list / creator / editor from legacy

## Goal

Replace the `<ComingSoon />` placeholder at [`packages/mobile/app/(app)/(tabs)/workouts.tsx`](<../../../packages/mobile/app/(app)/(tabs)/workouts.tsx>) with the real Workouts tab. Port three legacy mobile screens **verbatim**, wire to the V2 SST backend through the hexagonal port architecture, cache reads with a 5-min TTL, and queue writes through `SyncQueuePort`.

This is the **frontend track** of M2. Read this brief plus [`BRIEF.md`](./BRIEF.md), [`SMOKE_TEST.md`](./SMOKE_TEST.md), and the parent spec [`../../04-workout-management/`](../../04-workout-management/).

## The single most important rule

**Lift and shift the legacy UI verbatim.** Paste legacy JSX + StyleSheets in unchanged, only swap theme imports for `workoutsLegacyTheme.ts` (which extends `homeLegacyTheme.ts`). M1 burned a re-port cycle because the first attempt redesigned with Tamagui primitives and the result looked flatter than legacy. Same trap applies here. **Don't redesign during the port; M11 owns aesthetic polish.**

If you find yourself thinking "this could be cleaner," stop. Write `// TODO(M11): <brief note>` in place. Move on.

## Branch + workflow

- **Branch:** `feat/m2-workouts` (shared with the backend track) off fresh `main`
- **PR title:** `feat: workouts list + create + edit (M2)`
- **Frontend commit shape (lands after the backend commits in the shared branch's history):**
  1. `feat(mobile): workouts domain model + ApiPort + SQLite cache`
  2. `feat(mobile): workouts hooks + commands + sync queue wiring`
  3. `feat(mobile): port workouts list + popover + theme shim`
  4. `feat(mobile): port workouts creator + editor with exercise picker`
  5. `test(mobile): workouts containers, hooks, commands, two-user isolation`

Each implementation commit ends with:

```
Spec alignment: <citations from 04-workout-management/{design,requirements}.md>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

## Read first (in this order)

1. `packages/mobile/src/ui/containers/HomeContainer.tsx` + `presenters/HomePresenter.tsx` — the M1 reference for the 3-memo container pipeline. Mirror this structure exactly.
2. `packages/mobile/src/ui/theme/homeLegacyTheme.ts` — theme compat shim. M2 extends this into `workoutsLegacyTheme.ts`.
3. `packages/mobile/src/application/dashboard.query.ts` + `packages/mobile/src/hooks/useDashboard.tsx` — cache-first query + hook pattern.
4. `packages/mobile/src/ui/containers/ExerciseListContainer.tsx` — M0 reference; this container is **reused** inside `AddExercisePopover`.
5. **Legacy sources** — `/Users/bradleysimms-evans/Documents/projects/personal/persistence-mobile/app/(tabs)/workouts.tsx`, `app/workout-creator.tsx`, `app/workout-editor.tsx`, plus the `components/workouts/*` files those import.

## Files you'll add (under `packages/mobile/src/`)

```
domain/models/workout.ts                                  # Workout, WorkoutExercise, WorkoutVisibility, WorkoutListType, WorkoutQuota
application/workouts.query.ts                             # getWorkoutsQuery, getWorkoutQuery
application/workouts.commands.ts                          # createWorkoutCommand, updateWorkoutCommand, deleteWorkoutCommand
application/workouts.domain.ts                            # validateWorkout, propagateSupersetSharedFields, etc. — pure
hooks/useWorkouts.tsx                                     # cache-first, three-section parallel
hooks/useWorkout.tsx                                      # single workout for popover/editor

ui/theme/workoutsLegacyTheme.ts                           # extends homeLegacyTheme — adds any new tokens
ui/components/workouts/WorkoutCard/{WorkoutCard.tsx,styles.ts,index.ts}
ui/components/workouts/WorkoutSection/...
ui/components/workouts/WorkoutPopover/...
ui/components/workouts/WorkoutLimitIndicator/...
ui/components/workouts/QuickActions/...
ui/components/workouts/AddExercisePopover/...             # incl. AddExerciseList, AddExerciseListItem, ExerciseDetailsModal
ui/components/workouts/ExerciseConfigCard/...
ui/components/workouts/SearchBar/                         # only if not already in ui/components

ui/containers/WorkoutsListContainer.tsx
ui/containers/WorkoutCreatorContainer.tsx
ui/containers/WorkoutEditorContainer.tsx
ui/presenters/WorkoutsListPresenter.tsx
ui/presenters/WorkoutCreatorPresenter.tsx
ui/presenters/WorkoutEditorPresenter.tsx
ui/containers/__tests__/...
ui/presenters/__tests__/...
```

## Files you'll modify

- `packages/mobile/app/(app)/(tabs)/workouts.tsx` — replace `<ComingSoon />` with `<WorkoutsListContainer />`
- `packages/mobile/app/(app)/_layout.tsx` — register `workouts/create` and `workouts/[id]/edit` routes (modal stack)
- New screen files: `packages/mobile/app/(app)/workouts/create.tsx`, `packages/mobile/app/(app)/workouts/[id]/edit.tsx`
- `packages/mobile/src/domain/ports/api.port.ts` — replace M1 stub workout method signatures (nested exercises in create/update; quota in list response; new types)
- `packages/mobile/src/domain/ports/storage.port.ts` — add workout cache methods
- `packages/mobile/src/adapters/api/sst-api.adapter.ts` — implement all five workout methods against the M2 wire-format contract
- `packages/mobile/src/adapters/api/in-memory-api.adapter.ts` — same surface for tests
- `packages/mobile/src/adapters/storage/sqlite.adapter.ts` — add `cached_workouts` + `cached_workout_detail` tables + cache methods
- `packages/mobile/src/adapters/storage/in-memory-storage.adapter.ts` — same surface for tests
- `packages/mobile/src/adapters/sync-queue/...` — register workout intents (create / update / delete)

## Files you must NOT touch

- `packages/mobile/src/ui/containers/HomeContainer.tsx` — M1.
- `packages/mobile/src/ui/presenters/HomePresenter.tsx` — M1.
- `packages/mobile/src/ui/containers/ExerciseListContainer.tsx` — M0; reuse only.
- `packages/mobile/src/adapters/health/*` — M1.
- `microservices/core/` — backend track owns this.
- `packages/db/src/schema.ts` — M2 has no migration.

## Architecture (mirrors M1 exactly)

```
WorkoutsListContainer
  ├─ useWorkouts(userId)                      // hook: cache-first, parallel 3-section fetch
  │    ├─ StoragePort.getCachedWorkouts(userId, type)   for each type — cold-render fallback
  │    ├─ ApiPort.getWorkouts({ type })       // 3 parallel calls
  │    ├─ StoragePort.cacheWorkouts(...)      // userId-guarded write
  │    └─ inFlightRef = { userId, promise }   // account-switch safe
  ├─ useReferenceLists()                      // M0 — already in cache
  ├─ 3-memo pipeline:
  │    ├─ cachedPayload  (read from hook return)
  │    ├─ viewModel      (filter by search, derive section visibility, render-ready)
  │    └─ animationStyles
  └─ <WorkoutsListPresenter ... />            // pure render

WorkoutCreatorContainer
  ├─ form reducer: { name, description, estimatedDurationMinutes, exercises: WorkoutExercise[] }
  ├─ useReducer or useState<FormState>; isDirty derived from form ≠ initial
  ├─ submit → createWorkoutCommand(input)
  │    ├─ validateWorkout(input) → ValidationError[] | ok
  │    ├─ optimistically write to cached_workouts (Mine) with temp UUID
  │    ├─ enqueue SyncQueueIntent.createWorkout(input)
  │    └─ on sync success, swap temp UUID for server ID in cache
  └─ <WorkoutCreatorPresenter ... />

WorkoutEditorContainer
  ├─ useWorkout(id) — fetches detail, populates form on first render
  ├─ same form reducer; isDirty tracks divergence from server-loaded initial
  ├─ submit → updateWorkoutCommand(id, input)
  │    ├─ validateWorkout(input)
  │    ├─ optimistically update cached_workout_detail + cached_workouts(Mine)
  │    └─ enqueue SyncQueueIntent.updateWorkout(id, input)
  └─ <WorkoutEditorPresenter ... />
```

## Wire format the adapter implements

Documented in [`BACKEND_BRIEF.md`](./BACKEND_BRIEF.md) and `04-workout-management/design.md § API Contract`. Summary for the adapter:

| Operation                  | Path                                       | Envelope unwrap                                        | Notes                                                      |
| -------------------------- | ------------------------------------------ | ------------------------------------------------------ | ---------------------------------------------------------- |
| `getWorkouts({type})`      | `GET /workouts?type=...&limit=20&offset=0` | double `{ data, meta }` via `requestPaginatedEnvelope` | meta has `pagination.total`; `quota` only when `type=mine` |
| `getWorkout(id)`           | `GET /workouts/:id`                        | single `{ data }`                                      | 404 → `ApiError("not_found")`                              |
| `createWorkout(input)`     | `POST /workouts` body=input                | single `{ data }`                                      | 201 → success                                              |
| `updateWorkout(id, input)` | `PATCH /workouts/:id` body=input           | single `{ data }`                                      | full-replacement when `input.exercises` present            |
| `deleteWorkout(id)`        | `DELETE /workouts/:id`                     | 204 no body                                            | success → `ok(undefined)`                                  |

Use `request<T>` / `requestEnvelope<T>` / `requestPaginatedEnvelope<T>` helpers consistent with M0 and M1. Per-request timeout: 10s on the mutating endpoints (consistent with M1's `DASHBOARD_REQUEST_TIMEOUT_MS`).

## SQLite cache schema

Two new tables. Idempotent migration in `sqlite.adapter.ts` `bootstrapDb()`:

```sql
CREATE TABLE IF NOT EXISTS cached_workouts (
  user_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('mine', 'assigned', 'default')),
  payload TEXT NOT NULL,
  quota TEXT,
  synced_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, type)
);

CREATE TABLE IF NOT EXISTS cached_workout_detail (
  user_id TEXT NOT NULL,
  workout_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  synced_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, workout_id)
);
```

`WORKOUTS_LIST_STALE_AFTER_MS = 5 * 60 * 1000`. Same import / export pattern as `DASHBOARD_STALE_AFTER_MS`.

## Sync queue wiring

Workouts writes are intent-encoded. Each intent is the full desired payload (not a delta). The sync worker replays in order; conflicts are server-wins.

```typescript
// packages/mobile/src/domain/ports/sync.types.ts — extend the discriminated union
export type SyncIntent =
  | { kind: "createWorkout"; tempId: string; input: CreateWorkoutInput }
  | { kind: "updateWorkout"; id: string; input: UpdateWorkoutInput }
  | { kind: "deleteWorkout"; id: string }
  | ...; // M0 exercise intents stay
```

When `createWorkout` succeeds remotely, the worker:

1. Replaces the temp UUID in `cached_workouts` and `cached_workout_detail` with the server ID.
2. Updates any in-flight `updateWorkout` / `deleteWorkout` intents in the queue that reference the temp UUID.

This is similar to M0's exercise create-then-update sequence; reuse those primitives.

## Legacy port checklist

For each component, paste the legacy JSX + StyleSheet, swap the theme import path, retain prop names. Where the legacy hook (`useGetMyWorkouts`, `useEditWorkoutForm`, etc.) is imported, replace with the V2 hook (`useWorkouts`, container-side reducer for forms). Where `router.push('/workout-creator')` appears, change to `router.push('/workouts/create')`.

| Legacy file                                                   | V2 destination                                                       | Notes                                                                                                     |
| ------------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `app/(tabs)/workouts.tsx` (494 lines)                         | `WorkoutsListPresenter` (pure JSX) + `WorkoutsListContainer` (state) | Three sections, search bar, popover, quota                                                                |
| `app/workout-creator.tsx` (575 lines)                         | `WorkoutCreatorPresenter` + `WorkoutCreatorContainer`                | Form reducer, picker integration, superset propagation                                                    |
| `app/workout-editor.tsx` (650 lines)                          | `WorkoutEditorPresenter` + `WorkoutEditorContainer`                  | Async-loaded form, dirty flag, full-replacement PATCH                                                     |
| `components/workouts/WorkoutCard/`                            | `ui/components/workouts/WorkoutCard/`                                | Verbatim                                                                                                  |
| `components/workouts/WorkoutSection/`                         | `ui/components/workouts/WorkoutSection/`                             | Verbatim                                                                                                  |
| `components/workouts/WorkoutPopover/`                         | `ui/components/workouts/WorkoutPopover/`                             | Verbatim; M3 stub for "Start" CTA                                                                         |
| `components/workouts/WorkoutLimitIndicator/`                  | `ui/components/workouts/WorkoutLimitIndicator/`                      | Verbatim; consume `quota` from `useWorkouts`                                                              |
| `components/workouts/QuickActions/`                           | `ui/components/workouts/QuickActions/`                               | Verbatim                                                                                                  |
| `components/workouts/AddExercisePopover/` (and all sub-files) | `ui/components/workouts/AddExercisePopover/`                         | Verbatim — but the inner exercise list **must** wrap M0's `ExerciseListContainer` instead of legacy hooks |
| `components/workouts/ExerciseConfigCard/`                     | `ui/components/workouts/ExerciseConfigCard/`                         | Verbatim                                                                                                  |

## Active-session navigation stubs

Legacy "Start workout" CTAs (on `WorkoutCard` and `WorkoutPopover`) navigate to active-session screens. M2 routes them to a placeholder:

```typescript
// In the onPress handler of the legacy "Start" button:
// TODO(M3): replace with router.push(`/workouts/${id}/active`)
router.push(`/coming-soon?feature=active-session`);
```

If `/coming-soon` doesn't already exist, add a minimal route at `app/(app)/coming-soon.tsx` that renders the existing `<ComingSoon />` component with a `feature` query-param branch. Keep this lightweight — M3 will replace.

## M1 learnings to apply (do not re-discover)

1. **Verbatim port + theme shim.** See above. Don't redesign.
2. **3-memo pipeline.** `cachedPayload → viewModel → animationStyles`.
3. **Stable-method useCallback deps.** `[workouts.refresh, deleteWorkout]`, not `[workouts]`. Hook return objects are fresh every render.
4. **Stale-closure guards.** Any session-scoped async work checks `latestUserIdRef.current === userId` before writing state or storage. Apply to `useWorkouts.refresh`, sync-worker callbacks, and the form-submit completion handlers.
5. **`inFlightRef = { userId, promise }`.** Bare promise dedupe breaks on account switch.
6. **Rate-limit timestamps fire AFTER the gate** (if any rate limit applies). Not relevant for `useWorkouts` directly; relevant if you add a debounced search re-fetch.
7. **Reanimated carousel config** — only relevant if any workouts surface uses a carousel. The legacy creator/editor don't; the list doesn't either. Skip unless you discover one.

## Tests

- Pure-function tests on `validateWorkout`, `propagateSupersetSharedFields`, `groupAsSuperSet`, `ungroupSuperSet`, `reorderExercises`, `calculateEstimatedDuration`.
- Hook tests: `useWorkouts` (cache-first, parallel fetch, account-switch safety, stale-closure guard); `useWorkout(id)`.
- Adapter tests: `SSTApiAdapter.getWorkouts` envelope handling for all three `type`s; quota presence; error mapping.
- Container tests: `WorkoutsListContainer` view-model derivation, search filter, two-user cache isolation, popover open/close.
- Container tests: `WorkoutCreatorContainer` form-reducer transitions, validation, optimistic submit; `WorkoutEditorContainer` async-load + dirty flag.
- Presenter tests: snapshot + interaction tests on the three presenters' empty / loading / error / populated branches.
- Sync-queue test: enqueue createWorkout, replay, verify temp-ID swap.

Coverage: ≥90% on every metric for every changed file. Mobile aggregate stays above the M1 baseline (98 / 93 / 96 / 98).

## Quality gates

```
bun run prettier:check
bun run typecheck
bun run lint
bun run build
bun run test:unit
```

## PR description shape

```markdown
## Spec alignment

- 04-workout-management/design.md § Domain Model + § API Contract — implemented (mobile side)
- 04-workout-management/design.md § SQLite cache shape — implemented
- 04-workout-management/design.md § Offline Strategy — implemented (sync queue)
- 04-workout-management/requirements.md STORY-001 ACs 1.1–1.9 — list
- 04-workout-management/requirements.md STORY-002 ACs 2.1–2.12 — creator
- 04-workout-management/requirements.md STORY-003 ACs 3.1–3.4 — supersets
- 04-workout-management/requirements.md STORY-004 ACs 4.1–4.8 — editor
- 04-workout-management/requirements.md STORY-005 ACs 5.1, 5.4 — delete UI
- 04-workout-management/requirements.md STORY-006 AC 6.5 — visibility selector
- 04-workout-management/requirements.md STORY-007 ACs 7.1–7.4 — popover
- 04-workout-management/requirements.md STORY-008 ACs 8.1–8.5 — offline cache + queue

## How to view

[Reference SMOKE_TEST.md steps 1–11]

## Test coverage

[Pasted from `bun run test:unit --coverage` summary]
```

## Coordinate with the backend track

Both tracks land in the same PR (`feat/m2-workouts`); the backend commits land first in the branch's history so the mobile commits can run against the new wire format directly. The contract in `04-workout-management/design.md § API Contract` is binding for both sides.
